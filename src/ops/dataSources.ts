/**
 * Data-sources operations: document ingestion, corpus search, pipeline
 * configuration, and version management.
 *
 * Ops are pure (ctx, params) → typed result; no printing, no process coupling.
 * The CLI skin in commands/dataSources.ts owns everything flag-shaped (path
 * resolution, parseKeyValuePairs, configFromFlags, out/progress calls,
 * process.exit for wait-path exit codes).
 */

import { createHash } from 'node:crypto';

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import { elapsedSeconds, pollUntil, timedOut } from '../poll.js';
import { uploadDirect } from '../upload.js';
import type {
  DataSourcesBuildProgress,
  DataSourcesConfigResult,
  DataSourcesConfigUpdateResult,
  DataSourcesCreateResult,
  DataSourcesDeleteResult,
  DataSourcesDocument,
  DataSourcesDocumentConfirmResult,
  DataSourcesDocumentDeleteManyResult,
  DataSourcesDocumentDeleteResult,
  DataSourcesDocumentSelector,
  DataSourcesDocumentsResult,
  DataSourcesDocumentStatus,
  DataSourcesDropResult,
  DataSourcesIngestUpdate,
  DataSourcesListEntry,
  DataSourcesListResult,
  DataSourcesMoveResult,
  DataSourcesPromoteResult,
  DataSourcesRetrievalUpdate,
  DataSourcesRevectorizeResult,
  DataSourcesSearchResult,
  DataSourcesUploadTokenResult,
} from '../types/dataSources.js';

/** @internal Consumed by the CLI skin; waitForIngest documents the default. */
export const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 3000;

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/datasources`;
}

/**
 * The per-document summary projection used by waitForIngest, status, and the
 * revectorize watch loop in the skin. Exported so the skin can reuse it for
 * the revectorize path without re-implementing it.
 * @internal Presentation helper for the CLI skin, not client surface.
 */
export const summarize = (d: DataSourcesDocumentStatus) => ({
  id: d.id,
  filename: d.filename,
  status: d.status,
  chunks: d.chunkCount,
  pages: d.pageCount,
  ...(d.errorMessage ? { error: d.errorMessage } : {}),
});

// ─── addDocument ─────────────────────────────────────────────────────────────

export interface AddDocumentParams {
  /** Data source slug. Created on first use. */
  slug: string;
  /** Original filename — used as the key and for MIME-type inference. */
  filename: string;
  /** File bytes to upload. */
  content: Buffer;
  /**
   * Scalar tags filterable at search time (≤ 16 keys,
   * `string | number | boolean` values).
   */
  metadata?: Record<string, string | number | boolean>;
  /**
   * Receives the exact progress strings the CLI prints today:
   * - `${filename}: unchanged, skipped`
   * - `${filename}: uploading N MB…`
   */
  onProgress?: (message: string) => void;
}

export interface AddDocumentResult {
  filename: string;
  skipped: boolean;
  queued?: boolean;
  /**
   * The document, or the first of them on a mapped source. Null only when the
   * source's mapper answered `deletes` for the file.
   */
  document: DataSourcesDocument | null;
  /** Every document the file became — one on an unmapped source. */
  documents: DataSourcesDocument[];
  /** How the source took the file; absent when it was already current. */
  outcome?: 'unmapped' | 'documents' | 'passthrough' | 'deletes';
}

/**
 * Add one document to a data source.
 *
 * Three-step flow: hash → token → (skip-if-current) → upload → confirm.
 * Re-adding an unchanged file short-circuits at the token step and moves no
 * bytes. Re-adding with different `metadata` updates the tags in-place, also
 * without a re-upload. The data source is created on first use.
 *
 * @throws AdminApiError `invalid_content_hash` (400) — malformed hash
 *   (internal; `addDocument` computes this from `content`).
 * @example
 * const result = await admin.dataSources.addDocument({
 *   slug: 'policies',
 *   filename: 'contract.pdf',
 *   content: pdfBuffer,
 *   metadata: { department: 'legal', year: 2026 },
 * });
 */
export async function addDocument(
  ctx: AdminContext,
  params: AddDocumentParams,
): Promise<AddDocumentResult> {
  const { slug, filename, content, metadata, onProgress } = params;
  const contentHash = createHash('sha256').update(content).digest('hex');

  const token = await call<DataSourcesUploadTokenResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/upload-token`,
    {
      slug,
      filename,
      contentHash,
      ...(metadata ? { metadata } : {}),
    },
  );

  if (token.alreadyCurrent) {
    onProgress?.(`${filename}: unchanged, skipped`);
    return {
      filename,
      skipped: true,
      document: token.document,
      documents: token.documents ?? [token.document],
    };
  }

  onProgress?.(
    `${filename}: uploading ${(content.length / 1024 / 1024).toFixed(1)}MB…`,
  );
  await uploadDirect(token.upload, content, filename);

  const confirmed = await call<DataSourcesDocumentConfirmResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/documents`,
    {
      slug,
      filename,
      contentHash,
      contentType: token.contentType,
      size: content.length,
      ...(metadata ? { metadata } : {}),
    },
  );

  return {
    filename,
    skipped: false,
    queued: confirmed.queued,
    document: confirmed.document,
    documents:
      confirmed.documents ?? (confirmed.document ? [confirmed.document] : []),
    outcome: confirmed.outcome,
  };
}

// ─── waitForIngest ────────────────────────────────────────────────────────────

export interface WaitForIngestParams {
  slug: string;
  documentIds: string[];
  /** Defaults to DEFAULT_WAIT_TIMEOUT_MS (15 min). */
  timeoutMs?: number;
  /**
   * Receives the exact progress strings the CLI prints today:
   * `ingesting… X/Y done (Ns)`
   */
  onProgress?: (message: string) => void;
}

export type SummarizedDocument = ReturnType<typeof summarize>;

export interface WaitForIngestResult {
  status: 'up-to-date' | 'done' | 'error' | 'timeout';
  documents: SummarizedDocument[];
  /** Present only on status === 'timeout'. */
  error?: string;
}

/**
 * Poll until every queued document reaches a terminal state.
 *
 * Terminal states: `done` (all succeeded), `error` (at least one failed),
 * `timeout` (still processing after `timeoutMs`, default 15 minutes). Polls
 * every 3 seconds. Returns a typed result so the caller can branch on
 * `status` without parsing strings.
 *
 * The `dataSource: slug` envelope and exit-code handling stay in the CLI skin
 * so the printed JSON is byte-identical to the pre-refactor CLI.
 *
 * @example
 * const result = await admin.dataSources.waitForIngest({
 *   slug: 'policies',
 *   documentIds: [doc.id],
 *   onProgress: console.error,
 * });
 * if (result.status === 'error') { ... }
 */
export async function waitForIngest(
  ctx: AdminContext,
  params: WaitForIngestParams,
): Promise<WaitForIngestResult> {
  const { slug, documentIds, onProgress } = params;
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  if (documentIds.length === 0) {
    return { status: 'up-to-date', documents: [] };
  }

  const wanted = new Set(documentIds);
  const pendingOf = (docs: DataSourcesDocumentStatus[]) =>
    docs.filter((d) => d.status === 'processing');

  const outcome = await pollUntil(
    async () => {
      // Only the documents being waited on: the source may hold millions.
      const docs = await allDocuments(ctx, { slug, ids: documentIds });
      return (docs ?? []).filter((d) => wanted.has(d.id));
    },
    (tracked) => pendingOf(tracked).length === 0,
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (tracked, start) =>
        `ingesting… ${tracked.length - pendingOf(tracked).length}/${tracked.length} done (${elapsedSeconds(start)}s)`,
      onProgress,
    },
  );
  const tracked = outcome.value;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      documents: tracked.map(summarize),
      error: timedOut(
        timeoutMs,
        `with ${pendingOf(tracked).length} document(s) still processing`,
      ),
    };
  }
  return {
    status: tracked.some((d) => d.status === 'error') ? 'error' : 'done',
    documents: tracked.map(summarize),
  };
}

// ─── waitForCandidate ─────────────────────────────────────────────────────────

export interface WaitForCandidateParams {
  slug: string;
  /** Defaults to DEFAULT_WAIT_TIMEOUT_MS (15 min). */
  timeoutMs?: number;
  /** Receives `rebuilding… X/Y done (Ns)`. */
  onProgress?: (message: string) => void;
}

export interface WaitForCandidateResult {
  status: 'ready' | 'error' | 'timeout';
  /** The candidate's build counts when the wait ended; null when it had no candidate. */
  counts: DataSourcesBuildProgress | null;
  /** The failed documents, first page, when any failed. */
  documents: SummarizedDocument[];
  /** Present only on status === 'timeout'. */
  error?: string;
}

/** Failed documents fetched for a status or a candidate wait. */
export const FAILURES_PAGE = 50;

/**
 * Poll a candidate version (`revectorize`) until every document has built.
 * Reads the candidate's counts from the source list — one row, whatever the
 * corpus holds — and fetches the failures only at the end. `error` means at
 * least one failed; `promote` with `force` accepts that.
 */
export async function waitForCandidate(
  ctx: AdminContext,
  params: WaitForCandidateParams,
): Promise<WaitForCandidateResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  const outcome = await pollUntil(
    async () => {
      const { dataSources } = await list(ctx);
      const source = dataSources.find((s) => s.slug === params.slug);
      if (!source) {
        throw new Error(`Data source "${params.slug}" not found.`);
      }
      return source.candidate?.progress ?? null;
    },
    (progress) => progress === null || progress.processing === 0,
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (progress, start) =>
        progress
          ? `rebuilding… ${progress.done}/${progress.total} done (${elapsedSeconds(start)}s)`
          : `rebuilding… (${elapsedSeconds(start)}s)`,
      onProgress: params.onProgress,
    },
  );
  const counts = outcome.value;
  const failed =
    counts && counts.error > 0
      ? (
          await documents(ctx, {
            slug: params.slug,
            candidate: true,
            status: 'error',
            limit: FAILURES_PAGE,
          })
        ).documents.map(summarize)
      : [];
  if (!outcome.settled) {
    return {
      status: 'timeout',
      counts,
      documents: failed,
      error: timedOut(
        timeoutMs,
        `with ${counts?.processing ?? 0} document(s) still building`,
      ),
    };
  }
  return {
    status: counts && counts.error > 0 ? 'error' : 'ready',
    counts,
    documents: failed,
  };
}

// ─── documents ───────────────────────────────────────────────────────────────

export interface DocumentsParams {
  /** Data source slug. */
  slug: string;
  /** true → watch a candidate pipeline (revectorize in progress). */
  candidate?: boolean;
  /** Only these documents (at most DOCUMENTS_IDS_MAX per request). */
  ids?: string[];
  /** Page size, 1..1000 (server default 500). */
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
  /** By the time the document was added; oldest first unless said otherwise. */
  order?: 'oldest' | 'newest';
  /** The failed builds only, newest failure first. */
  status?: 'error';
  /** Filenames starting with this. */
  filename?: string;
}

/** The server's cap on `ids` per request; `allDocuments` chunks to it. */
export const DOCUMENTS_IDS_MAX = 200;

/**
 * Fetch one page of per-document ingest state for one pipeline, oldest first
 * unless `order` says otherwise; `status: 'error'` narrows to the failures and
 * `filename` to a name prefix.
 *
 * Returns an empty document list when the data source does not exist yet.
 * Pass `candidate: true` to watch a revectorization in progress. Follow
 * `nextCursor` for the next page, or use `allDocuments` to walk them all.
 *
 * @example
 * const { documents, nextCursor } = await admin.dataSources.documents({ slug: 'policies' });
 * const failed = await admin.dataSources.documents({ slug: 'policies', status: 'error' });
 */
export function documents(ctx: AdminContext, params: DocumentsParams) {
  return call<DataSourcesDocumentsResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/documents${qs({
      slug: params.slug,
      candidate: params.candidate || undefined,
      ids: params.ids?.length ? params.ids.join(',') : undefined,
      limit: params.limit,
      cursor: params.cursor,
      order: params.order,
      status: params.status,
      filename: params.filename,
    })}`,
  );
}

/**
 * Every document (or every one of `ids`), following pages to the end.
 *
 * With `ids`, requests are chunked to the server's per-request cap, so a wait
 * over hundreds of just-added files stays a handful of small calls rather than
 * a walk of the whole source.
 *
 * @example
 * const docs = await admin.dataSources.allDocuments({ slug: 'policies' });
 */
export async function allDocuments(
  ctx: AdminContext,
  params: Omit<DocumentsParams, 'cursor' | 'limit'>,
): Promise<DataSourcesDocumentStatus[]> {
  const groups: Array<string[] | undefined> = params.ids
    ? Array.from(
        { length: Math.ceil(params.ids.length / DOCUMENTS_IDS_MAX) },
        (_, i) =>
          params.ids!.slice(i * DOCUMENTS_IDS_MAX, (i + 1) * DOCUMENTS_IDS_MAX),
      )
    : [undefined];
  const out: DataSourcesDocumentStatus[] = [];
  for (const ids of groups) {
    let cursor: string | undefined;
    do {
      const page = await documents(ctx, {
        slug: params.slug,
        candidate: params.candidate,
        ids,
        limit: 1000,
        cursor,
        order: params.order,
        status: params.status,
        filename: params.filename,
      });
      out.push(...(page.documents ?? []));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return out;
}

// ─── list ─────────────────────────────────────────────────────────────────────

/**
 * List all data sources with document counts, build progress, and active
 * version metadata.
 *
 * @example
 * const { dataSources } = await admin.dataSources.list();
 */
export function list(ctx: AdminContext) {
  return call<DataSourcesListResult>(ctx, 'GET', base(ctx.appId));
}

// ─── search ──────────────────────────────────────────────────────────────────

export interface SearchParams {
  /** Data source slug. */
  slug: string;
  /** Natural-language or keyword query. */
  query: string;
  /** Results to return (default 5, max 50). */
  topK?: number;
  /** 'hybrid' (default) | 'semantic' | 'lexical'. */
  mode?: string;
  /** Metadata equality filter or the full filter grammar as a plain object. */
  filter?: Record<string, unknown>;
  /** Cap hits per document; backfills from others. */
  maxPerDocument?: number;
  /** Return query-term offsets per hit. */
  highlight?: boolean;
  /** Search the candidate version instead of the live one. */
  candidate?: boolean;
  /** Assembled from triState(a, 'rerank'/'hybrid') in the skin. */
  retrieval?: Record<string, boolean>;
}

/**
 * Query a data source and return ranked passages with citations.
 *
 * `mode` in the response reports what actually ran (e.g. `reranked: false`
 * after an adaptive skip) rather than what was requested, so measurements
 * attribute numbers to the right path. Pass `candidate: true` to evaluate a
 * candidate pipeline before promoting it.
 *
 * @throws AdminApiError `no_candidate_pipeline` (404) — `candidate: true` but
 *   no revectorization is in flight; `invalid_query` (400); `invalid_mode`
 *   (400).
 * @example
 * const { results } = await admin.dataSources.search({
 *   slug: 'policies',
 *   query: 'what are the payment terms?',
 * });
 */
export function search(ctx: AdminContext, params: SearchParams) {
  const {
    slug,
    query,
    topK,
    mode,
    filter,
    maxPerDocument,
    highlight,
    candidate,
    retrieval,
  } = params;
  return call<DataSourcesSearchResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/search`,
    {
      slug,
      query,
      ...(topK ? { topK } : {}),
      ...(mode ? { mode } : {}),
      ...(filter ? { filter } : {}),
      ...(maxPerDocument !== undefined ? { maxPerDocument } : {}),
      ...(highlight ? { highlight: true } : {}),
      ...(candidate ? { candidate: true } : {}),
      ...(retrieval && Object.keys(retrieval).length ? { retrieval } : {}),
    },
  );
}

// ─── config ───────────────────────────────────────────────────────────────────

/**
 * Read the full pipeline configuration for one data source.
 *
 * Returns `ingest` (pinned — requires a revectorize to change) and
 * `retrieval` (live — takes effect on the next query, no rebuild needed).
 *
 * @throws AdminApiError `data_source_not_found` (404).
 * @example
 * const { ingest, retrieval } = await admin.dataSources.configGet('policies');
 */
export function configGet(ctx: AdminContext, slug: string) {
  return call<DataSourcesConfigResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/config?slug=${encodeURIComponent(slug)}`,
  );
}

export interface ConfigSetParams {
  /** Data source slug. */
  slug: string;
  /**
   * Ingest settings (pinned). Changes are rejected on a populated source —
   * use `revectorize` instead to rebuild alongside the live one.
   */
  ingest?: DataSourcesIngestUpdate;
  /**
   * Retrieval settings (live). Take effect on the next query; no rebuild
   * required.
   */
  retrieval?: DataSourcesRetrievalUpdate;
  /**
   * Where the corpus lives: a dedicated resource (see `admin.infra`) or the
   * shared pool. An empty source moves on the spot; a populated one starts a
   * background move (see `move`) and the response carries its `migration`.
   */
  placement?: { resourceId: string } | 'shared';
}

/**
 * Update pipeline configuration.
 *
 * `retrieval` changes take effect on the next query at no cost. `ingest`
 * changes are rejected once the source has documents — use `revectorize`
 * instead, which builds a new version alongside the live one so search never
 * degrades.
 *
 * @throws AdminApiError `data_source_not_found` (404),
 *   `data_source_migrating` (422) while a move is in flight.
 * @example
 * await admin.dataSources.configSet({
 *   slug: 'policies',
 *   retrieval: { rerank: { enabled: true } },
 * });
 */
export function configSet(ctx: AdminContext, params: ConfigSetParams) {
  const { slug, ingest, retrieval, placement } = params;
  return call<DataSourcesConfigUpdateResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/config`,
    {
      slug,
      ...(ingest ? { ingest } : {}),
      ...(retrieval ? { retrieval } : {}),
      ...(placement !== undefined ? { placement } : {}),
    },
  );
}

// ─── create ──────────────────────────────────────────────────────────────────

export interface CreateParams {
  /** Data source slug: lowercase [a-z0-9_-], up to 64 characters. */
  slug: string;
  /** Display name. */
  name?: string;
  /** Pinned ingest settings for the new pipeline; platform defaults otherwise. */
  ingest?: DataSourcesIngestUpdate;
  /**
   * Where the corpus lives from the start: a dedicated resource (see
   * `admin.infra`) or the shared pool (the default).
   */
  placement?: { resourceId: string } | 'shared';
}

/**
 * Create an empty data source, optionally on dedicated capacity.
 *
 * The one-step way to start a corpus on a resource. `add` also creates a
 * source on first use, but on the shared pool. Calling this for a source that
 * already exists returns it; a placement given then follows `configSet`'s
 * rule — an empty source moves on the spot, a populated one starts a move.
 *
 * @throws AdminApiError `invalid_data_source` (400), `data_source_limit` (422),
 *   `resource_not_found` (404), `resource_destroyed` (422),
 *   `data_source_migrating` (422), `capacity_exceeded` (422).
 * @example
 * await admin.dataSources.create({ slug: 'archive', placement: { resourceId } });
 */
export function create(ctx: AdminContext, params: CreateParams) {
  const { slug, name, ingest, placement } = params;
  return call<DataSourcesCreateResult>(ctx, 'POST', base(ctx.appId), {
    slug,
    ...(name ? { name } : {}),
    ...(ingest ? { ingest } : {}),
    ...(placement !== undefined ? { placement } : {}),
  });
}

// ─── move ────────────────────────────────────────────────────────────────────

export interface MoveParams {
  /** Data source slug. */
  slug: string;
  /** A dedicated resource (see `admin.infra`) or the shared pool. */
  placement: { resourceId: string } | 'shared';
}

/**
 * Move a data source between placements: shared → dedicated, dedicated →
 * shared, or one resource to another.
 *
 * A populated source is copied onto the target in the background from its
 * stored vectors — nothing is re-extracted or re-embedded — and flips when the
 * copy lands. Search keeps serving from the old placement meanwhile. Adding,
 * removing or reconfiguring documents is refused with `data_source_migrating`
 * until it finishes; `waitForMove` blocks on that. Moving to `'shared'` is how
 * a source leaves a resource that is about to be destroyed.
 *
 * @throws AdminApiError `data_source_not_found` (404), `same_placement` (400),
 *   `data_source_busy` (422) while documents are still building or a
 *   candidate version exists, `data_source_migrating` (422), `capacity_<phase>`
 *   (422) when the target resource is not active, `capacity_exceeded` (422)
 *   when the target is too small, `resource_not_found` (404).
 * @example
 * await admin.dataSources.move({ slug: 'archive', placement: { resourceId } });
 * const result = await admin.dataSources.waitForMove({ slug: 'archive' });
 */
export function move(ctx: AdminContext, params: MoveParams) {
  return call<DataSourcesMoveResult>(ctx, 'POST', `${base(ctx.appId)}/move`, {
    slug: params.slug,
    placement: params.placement,
  });
}

export interface WaitForMoveParams {
  slug: string;
  /** Defaults to DEFAULT_WAIT_TIMEOUT_MS (15 min). */
  timeoutMs?: number;
  /** Receives `moving… X/Y documents (Ns)`. */
  onProgress?: (message: string) => void;
}

export type WaitForMoveResult =
  | { status: 'done'; source: DataSourcesListEntry }
  | { status: 'failed'; source: DataSourcesListEntry; error: string }
  | { status: 'timeout'; source: DataSourcesListEntry; error: string };

/**
 * Poll until a source's move has landed, failed, or the timeout elapses.
 *
 * Reads the source from `list` each poll; done when no move is in flight. A
 * failed move returns immediately with the platform's error.
 *
 * @throws AdminApiError `data_source_not_found` (404).
 */
export async function waitForMove(
  ctx: AdminContext,
  params: WaitForMoveParams,
): Promise<WaitForMoveResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const outcome = await pollUntil(
    async () => {
      const { dataSources } = await list(ctx);
      const source = dataSources.find((s) => s.slug === params.slug);
      if (!source) {
        throw new Error(`Data source "${params.slug}" not found.`);
      }
      return source;
    },
    (source) => !source.migration || source.migration.error !== null,
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (source, start) =>
        `moving… ${source.migration!.copied}/${source.migration!.total} documents (${elapsedSeconds(start)}s)`,
      onProgress: params.onProgress,
    },
  );
  const source = outcome.value;
  const migration = source.migration;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      source,
      error: timedOut(
        timeoutMs,
        `with ${migration!.copied}/${migration!.total} documents copied`,
      ),
    };
  }
  if (migration?.error) {
    return { status: 'failed', source, error: migration.error };
  }
  return { status: 'done', source };
}

// ─── revectorize ──────────────────────────────────────────────────────────────

export interface RevectorizeParams {
  /** Data source slug. */
  slug: string;
  /** Ingest settings for the new version. Omit to adopt platform defaults. */
  ingest?: DataSourcesIngestUpdate;
}

/**
 * Start a new candidate pipeline alongside the live one.
 *
 * Builds a new version with the supplied settings, or platform defaults when
 * none are given (the upgrade path for a source pinned to an older chunker).
 * Search keeps serving the active version throughout. Reuses stored
 * extractions, so changing chunking never re-runs document extraction — only
 * re-chunking and re-embedding. Call `promote` to cut over.
 *
 * @throws AdminApiError `data_source_not_found` (404).
 * @example
 * const { candidateVersion } = await admin.dataSources.revectorize({
 *   slug: 'policies',
 *   ingest: { chunking: { maxChars: 900 } },
 * });
 */
export function revectorize(ctx: AdminContext, params: RevectorizeParams) {
  const { slug, ingest } = params;
  return call<DataSourcesRevectorizeResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/revectorize`,
    {
      slug,
      ...(ingest ? { ingest } : {}),
    },
  );
}

// ─── promote ──────────────────────────────────────────────────────────────────

export interface PromoteParams {
  /** Data source slug. */
  slug: string;
  /** Promote even if some candidate documents failed. */
  force?: boolean;
}

/**
 * Make the candidate pipeline version live.
 *
 * Atomically swaps the candidate for the active version and retires the old
 * one. Without `force`, promotion is blocked when any candidate document
 * failed. The retired version is kept; discard it with `drop` once rollback
 * is no longer wanted.
 *
 * @throws AdminApiError `data_source_not_found` (404).
 * @example
 * const { activeVersion } = await admin.dataSources.promote({ slug: 'policies' });
 */
export function promote(ctx: AdminContext, params: PromoteParams) {
  return call<DataSourcesPromoteResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/promote`,
    {
      slug: params.slug,
      ...(params.force ? { force: true } : {}),
    },
  );
}

// ─── drop ─────────────────────────────────────────────────────────────────────

export interface DropParams {
  /** Data source slug. */
  slug: string;
  /** Version number to drop. Omitted → the candidate is dropped. */
  version?: number;
}

/**
 * Discard a candidate or retired pipeline version.
 *
 * Never touches the active version. Omit `version` to drop the candidate;
 * pass a specific number to drop a retired version once rollback is no longer
 * wanted.
 *
 * @throws AdminApiError `data_source_not_found` (404); `pipeline_not_found`
 *   (404) — no candidate exists, or the version number is unknown.
 * @example
 * await admin.dataSources.drop({ slug: 'policies' }); // drops the candidate
 */
export function drop(ctx: AdminContext, params: DropParams) {
  return call<DataSourcesDropResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/versions/drop`,
    {
      slug: params.slug,
      ...(params.version !== undefined ? { version: params.version } : {}),
    },
  );
}

// ─── rm (document delete) ─────────────────────────────────────────────────────

export interface RmParams {
  /** Data source slug. */
  slug: string;
  /** UUID of the document to remove. */
  documentId: string;
}

/**
 * Remove one document and its vectors from a data source.
 *
 * Deletes across every pipeline version, not just the active one — a document
 * deleted mid-migration is gone from the candidate too.
 *
 * @throws AdminApiError `data_source_not_found` (404); `document_not_found`
 *   (404).
 * @example
 * await admin.dataSources.rm({ slug: 'policies', documentId });
 */
export function rm(ctx: AdminContext, params: RmParams) {
  return call<DataSourcesDocumentDeleteResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/documents/delete`,
    {
      slug: params.slug,
      documentId: params.documentId,
    },
  );
}

// ─── rmWhere (documents by filter) ───────────────────────────────────────────

export interface RmWhereParams {
  /** Data source slug. */
  slug: string;
  filter: DataSourcesDocumentSelector;
}

/**
 * Remove one page (up to 1,000) of the documents matching a selector, across
 * every pipeline version, and report how many still match. Loop while
 * `remaining > 0`; `rmWhereAll` does that.
 *
 * @throws AdminApiError `data_source_not_found` (404), `invalid_filter` (400),
 *   `data_source_busy` (422) while a job is in flight, `data_source_migrating`
 *   (422) during a move.
 * @example
 * await admin.dataSources.rmWhere({ slug: 'archive', filter: { metadata: { year: 2019 } } });
 */
export function rmWhere(ctx: AdminContext, params: RmWhereParams) {
  return call<DataSourcesDocumentDeleteManyResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/documents/delete-many`,
    { slug: params.slug, filter: params.filter },
  );
}

/** `rmWhere` until nothing matches. Reports each page through `onProgress`. */
export async function rmWhereAll(
  ctx: AdminContext,
  params: RmWhereParams & { onProgress?: (message: string) => void },
): Promise<{ deleted: number }> {
  let deleted = 0;
  while (true) {
    const page = await rmWhere(ctx, params);
    deleted += page.deleted;
    if (page.remaining === 0 || page.deleted === 0) {
      return { deleted };
    }
    params.onProgress?.(
      `removed ${deleted.toLocaleString()} so far, ${page.remaining.toLocaleString()} remaining…`,
    );
  }
}

// ─── deleteSource ─────────────────────────────────────────────────────────────

/**
 * Delete a whole data source — every version, every document, and every byte.
 *
 * Extraction caches survive (shared across sources by content hash), so
 * re-ingesting the same files into a new source costs no re-extraction.
 * Manage-plane only: running app code has no equivalent.
 *
 * @throws AdminApiError `data_source_not_found` (404).
 * @example
 * const { documents, versions } = await admin.dataSources.deleteSource('policies');
 */
export function deleteSource(ctx: AdminContext, slug: string) {
  return call<DataSourcesDeleteResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/delete`,
    { slug },
  );
}
