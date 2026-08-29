/**
 * CLI skin for the `files` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/files.js (pure, typed); response
 * shapes in ../types/files.js.
 *
 * CLI skin retains: fs read/write with WORKSPACE_DIR-relative path resolution
 * and the streamed (never buffered) download to disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { type Args, type CommandSpec } from '../args.js';
import { WORKSPACE_DIR } from '../config.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as files from '../ops/files.js';
import { out, progress } from '../output.js';
import type { Handler } from '../types.js';

const DEFAULT_STORE = 'assets';

const ACCESS_FLAGS = {
  public: { type: 'boolean' },
  private: { type: 'boolean' },
} as const;

export const filesSpecs = {
  'files put': {
    usage:
      'Usage: remy-admin files put [--public|--private] [--store <name>] [--key <key>] [--content-type <mime>] [--cache-control <value>] <file>',
    positionals: [{ name: 'file', required: true }],
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      key: { type: 'string' },
      'content-type': { type: 'string' },
      'cache-control': { type: 'string' },
    },
  },
  'files get': {
    usage:
      'Usage: remy-admin files get [--public|--private] [--store <name>] [--out <path>] <key>',
    positionals: [{ name: 'key', required: true }],
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      out: { type: 'string' },
    },
  },
  'files sign': {
    usage:
      'Usage: remy-admin files sign [--public|--private] [--store <name>] [--ttl <seconds>] --key <key>',
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      key: { type: 'string' },
      ttl: { type: 'number', min: 1 },
    },
  },
  'files stat': {
    usage:
      'Usage: remy-admin files stat [--public|--private] [--store <name>] --key <key>',
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      key: { type: 'string' },
    },
  },
  'files ls': {
    usage:
      'Usage: remy-admin files ls [--public|--private] [--store <name>] [--prefix <prefix>] [--q <substring>] [--cursor <cursor>] [--limit <n>]',
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      prefix: { type: 'string' },
      q: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'number', min: 1 },
    },
  },
  'files list': {
    usage: 'Usage: remy-admin files list',
  },
  'files rm': {
    usage: 'Usage: remy-admin files rm --store <name> --key <key> [--private]',
    flags: {
      ...ACCESS_FLAGS,
      store: { type: 'string' },
      key: { type: 'string' },
    },
  },
} satisfies Record<string, CommandSpec>;

// Default public (the marquee use is baking public marketing assets); --private
// overrides. If both are passed, private wins (fail safe).
function resolveAccess(a: Args): files.FileAccess {
  return a.bool('private') ? 'private' : 'public';
}

function storeOf(a: Args): string {
  return a.str('store') || DEFAULT_STORE;
}

function requireKeyFlag(a: Args): string {
  const key = a.str('key');
  if (!key) {
    fatal('--key is required.');
  }
  return key;
}

function refOf(a: Args, key: string): files.FileRef {
  return { store: storeOf(a), access: resolveAccess(a), key };
}

async function filesPut(ctx: AdminContext, a: Args) {
  const file = a.req('file');
  const abs = path.isAbsolute(file) ? file : path.join(WORKSPACE_DIR, file);

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(abs);
  } catch (err: any) {
    fatal(`Could not read file "${file}": ${err.message}`);
  }

  out(
    await files.put(ctx, {
      content: bytes,
      store: storeOf(a),
      access: resolveAccess(a),
      key: a.str('key'),
      filename: path.basename(file),
      contentType: a.str('content-type'),
      cacheControl: a.str('cache-control'),
      onProgress: progress,
    }),
  );
}

/** Mint a read link and stream the bytes to disk (never buffered — large
 *  objects are the whole point of this command). */
async function filesGet(ctx: AdminContext, a: Args) {
  const key = a.req('key');
  const ref = refOf(a, key);
  const { url } = await files.sign(
    ctx,
    ref,
    ref.access === 'private' ? 60 : undefined,
  );

  const outPath = a.str('out') || path.basename(key);
  const abs = path.isAbsolute(outPath)
    ? outPath
    : path.join(WORKSPACE_DIR, outPath);

  // Plain fetch (the link is self-authorizing) — no timeout on the byte
  // transfer itself.
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    fatal(`Download failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
    fs.createWriteStream(abs),
  );
  out({ path: abs, size: fs.statSync(abs).size });
}

async function filesSign(ctx: AdminContext, a: Args) {
  out(await files.sign(ctx, refOf(a, requireKeyFlag(a)), a.num('ttl')));
}

async function filesStat(ctx: AdminContext, a: Args) {
  out(await files.stat(ctx, refOf(a, requireKeyFlag(a))));
}

async function filesLs(ctx: AdminContext, a: Args) {
  out(
    await files.ls(ctx, {
      store: storeOf(a),
      access: resolveAccess(a),
      prefix: a.str('prefix'),
      q: a.str('q'),
      cursor: a.str('cursor'),
      limit: a.num('limit'),
    }),
  );
}

async function filesList(ctx: AdminContext) {
  out(await files.summary(ctx));
}

async function filesRm(ctx: AdminContext, a: Args) {
  const store = a.str('store');
  const key = a.str('key');
  if (!store) {
    fatal('--store is required.');
  }
  if (!key) {
    fatal('--key is required.');
  }
  out(await files.remove(ctx, { store, access: resolveAccess(a), key }));
}

export const filesHandlers = {
  'files put': filesPut,
  'files get': filesGet,
  'files sign': filesSign,
  'files stat': filesStat,
  'files ls': filesLs,
  'files list': filesList,
  'files rm': filesRm,
} satisfies Record<keyof typeof filesSpecs, Handler>;

export const filesHelp = `remy-admin files — Store, retrieve, and share files in the app's stores.

Subcommands:
  put    Upload a file (any size up to 5 GiB — bytes go directly to storage) and print its long-lived URL
  get    Download an object to disk
  sign   Print a shareable link (private → signed + expiring; public → permanent)
  stat   Object metadata without downloading (404 = doesn't exist)
  ls     List objects in a store (prefix filter or substring search)
  list   Summary of all stores (object counts + total bytes)
  rm     Delete an object from a store

Usage:
  remy-admin files put [--public|--private] [--store <name>] [--key <key>] [--cache-control <value>] <file>
  remy-admin files get [--private] [--store <name>] [--out <path>] <key>
  remy-admin files sign [--private] [--store <name>] [--ttl <seconds>] --key <key>
  remy-admin files stat [--private] [--store <name>] --key <key>
  remy-admin files ls [--private] [--store <name>] [--prefix <prefix>] [--q <substring>] [--limit <n>]
  remy-admin files list
  remy-admin files rm --store <name> --key <key> [--private]

Examples:
  remy-admin files put --public ./hero.jpg
  remy-admin files put --private --store handoff ./export.tar.gz
  remy-admin files sign --private --store handoff --key <key> --ttl 86400
  remy-admin files get --private --store handoff --out ./export.tar.gz <key>
  remy-admin files rm --store handoff --key <key> --private

Notes:
  - Defaults to a public store named 'assets'; pass --private / --store to change.
  - Handing someone a large or sensitive file? Use a PRIVATE store + \`sign\`:
    the link is unguessable, expires (--ttl seconds, max 7 days), and the object
    stays deletable with \`rm\`. Never use the account media CDN
    (\`mindstudio upload\`) for sensitive material — those URLs are public and
    permanent.
  - put: the key defaults to a content hash (sha256) of the bytes, so
    re-uploading the same file is idempotent and its URL is safe to bake into
    source. Pass --key for a stable, overwritable name (e.g. a config JSON the
    frontend fetches).
  - CDN caching follows the object's Cache-Control: content-hash keys default to
    immutable (cache-forever); --key'd objects default to public, max-age=300 so
    an overwrite propagates within ~5 minutes. Pass --cache-control to override.
  - Public image URLs accept transform params, e.g. ?w=400&fit=cover.`;
