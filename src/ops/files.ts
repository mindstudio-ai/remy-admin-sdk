/**
 * File-store operations: presigned uploads, read links, metadata, listing,
 * deletion. Pure (ctx, params) → typed result; the CLI skin owns everything
 * filesystem-shaped (path resolution, reading/writing disk).
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import { uploadDirect } from '../upload.js';
import type {
  FilesDeleteResult,
  FilesListResult,
  FilesLsResult,
  FilesStatResult,
  FilesUploadUrlResult,
  FilesUrlResult,
} from '../types/files.js';

export type FileAccess = 'public' | 'private';

export interface FileRef {
  /** Store name (e.g. 'assets'). */
  store: string;
  /** 'public' or 'private'. */
  access: FileAccess;
  /** Store-relative object key. */
  key: string;
}

export interface FilesPutParams {
  content: Buffer;
  store: string;
  access: FileAccess;
  /**
   * Omitted → content-addressed: `<sha256(content)><ext-of-filename>`.
   * Idempotent and immutable, so the returned URL is safe to bake into source.
   */
  key?: string;
  /** Used for the upload form part name and the default key's extension. */
  filename?: string;
  contentType?: string;
  /**
   * Omitted → content-addressed public objects default to
   * `public, max-age=31536000, immutable` (their keys are never reused);
   * everything else falls through to the server default.
   */
  cacheControl?: string;
  /** Called just before the byte upload starts. */
  onProgress?: (message: string) => void;
}

/**
 * Upload a file via presigned POST (up to 5 GiB).
 *
 * The API mints a presigned S3 POST; bytes go straight to storage, bypassing
 * the API's JSON body limit. The key defaults to sha256(content) plus the
 * filename extension (see `FilesPutParams.key`), making re-uploads of the same
 * bytes idempotent and their URL safe to bake into source. Pass `key` for a
 * stable, overwritable name (e.g. a config JSON the frontend fetches).
 *
 * @throws AdminApiError `invalid_store` (400); `invalid_access` (400);
 *   `invalid_key` (400).
 * @example
 * const { key, url } = await admin.files.put({
 *   content: imageBuffer,
 *   store: 'assets',
 *   access: 'public',
 *   filename: 'hero.jpg',
 * });
 */
export async function put(
  ctx: AdminContext,
  params: FilesPutParams,
): Promise<{ key: string; url: string }> {
  const { content, store, access, filename } = params;
  const key =
    params.key ||
    `${createHash('sha256').update(content).digest('hex')}${
      filename ? path.extname(filename) : ''
    }`;
  const cacheControl =
    params.cacheControl ||
    (!params.key && access === 'public'
      ? 'public, max-age=31536000, immutable'
      : undefined);

  const presign = await call<FilesUploadUrlResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/file-storage/upload-url`,
    {
      store,
      access,
      key,
      maxSize: content.length,
      ...(params.contentType ? { contentType: params.contentType } : {}),
      ...(cacheControl ? { cacheControl } : {}),
    },
  );

  params.onProgress?.(
    `uploading ${(content.length / 1024 / 1024).toFixed(1)}MB…`,
  );
  await uploadDirect(
    { uploadUrl: presign.uploadUrl, uploadFields: presign.uploadFields },
    content,
    filename ?? key,
  );

  return { key: presign.key, url: presign.url };
}

/**
 * Mint a read link for one object.
 *
 * Private objects return a signed, expiring URL with `expiresAt` (ttl clamped
 * server-side to [60s, 7d], default 300s). Public objects return a permanent
 * on-domain URL with no expiry. Use a private store plus `sign` as the
 * sensitive-file handoff channel — links are unguessable and the object stays
 * deletable.
 *
 * @param ttlSeconds Requested TTL in seconds (clamped to [60, 604800]; default
 *   300). Ignored for public objects.
 * @throws AdminApiError `invalid_store` (400); `invalid_access` (400);
 *   `invalid_key` (400); `file_flagged` (403) — the object was flagged by AV
 *   scanning and cannot be linked.
 * @example
 * const { url, expiresAt } = await admin.files.sign(
 *   { store: 'handoff', access: 'private', key },
 *   86400,
 * );
 */
export function sign(ctx: AdminContext, ref: FileRef, ttlSeconds?: number) {
  return call<FilesUrlResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/file-storage/url${qs({ ...ref, ttl: ttlSeconds })}`,
  );
}

/**
 * Download an object's bytes in-process.
 *
 * Mints a 60s presigned link via `sign`, then plain-fetches it — the link is
 * self-authorizing, so no auth headers are needed for the byte transfer. No
 * timeout on the byte stream; large objects are the whole point.
 *
 * @throws AdminApiError `file_flagged` (403) — the object was flagged by AV
 *   scanning; also propagates `sign` errors.
 * @example
 * const { bytes, contentType } = await admin.files.fetchBytes({
 *   store: 'handoff',
 *   access: 'private',
 *   key,
 * });
 */
export async function fetchBytes(
  ctx: AdminContext,
  ref: FileRef,
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const { url } = await sign(
    ctx,
    ref,
    ref.access === 'private' ? 60 : undefined,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type'),
  };
}

/**
 * Object metadata (size, contentType, updatedAt, scan status) — no download.
 *
 * A missing key throws AdminApiError 404, so this doubles as an existence
 * check without transferring any bytes.
 *
 * @throws AdminApiError `invalid_store` (400); `invalid_access` (400);
 *   `invalid_key` (400); 404 if the key does not exist.
 * @example
 * const meta = await admin.files.stat({
 *   store: 'assets',
 *   access: 'public',
 *   key: 'hero.jpg',
 * });
 */
export function stat(ctx: AdminContext, ref: FileRef) {
  return call<FilesStatResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/file-storage/metadata${qs(ref)}`,
  );
}

export interface FilesLsParams {
  /** Store name (e.g. 'assets'). */
  store: string;
  /** 'public' or 'private'. */
  access: FileAccess;
  /** Return only keys that start with this string. */
  prefix?: string;
  /** Server-side substring search (switches the listing mode). */
  q?: string;
  /** Pagination cursor from the previous page's `cursor` field. */
  cursor?: string;
  /** Maximum objects to return per page. */
  limit?: number;
}

/**
 * List objects in one store with optional prefix filtering or substring search.
 *
 * Flat list by default. Pass `q` for substring search across the whole store
 * (overrides `prefix`, delimiter ignored). Results are paginated — follow the
 * returned `cursor` to fetch the next page.
 *
 * @throws AdminApiError `invalid_store` (400); `invalid_access` (400).
 * @example
 * const { files, cursor } = await admin.files.ls({
 *   store: 'assets',
 *   access: 'public',
 *   prefix: 'images/',
 * });
 */
export function ls(ctx: AdminContext, params: FilesLsParams) {
  return call<FilesLsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/file-storage${qs(params)}`,
  );
}

/**
 * Store-level summary: every store with object counts, total bytes, and
 * AV/PII scan status histograms.
 *
 * @example
 * const { stores, totalObjects } = await admin.files.summary();
 */
export function summary(ctx: AdminContext) {
  return call<FilesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/file-storage/summary`,
  );
}

/**
 * Delete one object from a store.
 *
 * @throws AdminApiError `invalid_store` (400); `invalid_access` (400);
 *   `invalid_key` (400).
 * @example
 * await admin.files.remove({ store: 'handoff', access: 'private', key });
 */
export function remove(ctx: AdminContext, ref: FileRef) {
  return call<FilesDeleteResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/file-storage/delete`,
    { store: ref.store, access: ref.access, keys: [ref.key] },
  );
}
