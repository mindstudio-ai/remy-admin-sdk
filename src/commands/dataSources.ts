/**
 * CLI skin for the `datasources` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/dataSources.js (pure, typed); response
 * shapes in ../types/dataSources.js.
 *
 * CLI skin retains: fs reads with WORKSPACE_DIR-relative path resolution, the
 * exit codes of the waits, and progress printing.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type Args, type CommandSpec, type FlagSpec } from '../args.js';
import { WORKSPACE_DIR } from '../config.js';
import type { AdminContext } from '../ctx.js';
import { CliError, EXIT, fatal } from '../errors.js';
import * as dataSources from '../ops/dataSources.js';
import { out, progress } from '../output.js';
import type { Handler } from '../types.js';
import type {
  DataSourcesIngestUpdate,
  DataSourcesRetrievalUpdate,
} from '../types/dataSources.js';
import { DEFAULT_SOURCE, sourceOf } from './_shared/dataSources.js';
import { dataSourceConnectorsHelp } from './dataSourceConnectors.js';
import { dataSourceEvalsHelp } from './dataSourceEvals.js';
import { dataSourceJobsHelp } from './dataSourceJobs.js';
import { dataSourceMappersHelp } from './dataSourceMappers.js';

/**
 * Pipeline settings, shared by `config` and `revectorize` so the two can never
 * disagree about what's tunable.
 *
 * Booleans are strings rather than flags because they're TRI-STATE here:
 * "leave alone" has to be distinguishable from "turn off", and a bare
 * `--contextual` can only ever mean true.
 */
// Pinned — changing any of these needs a re-vectorize. `create` takes exactly
// these, since they are what a new pipeline is born with.
const INGEST_FLAGS = {
  chunking: { type: 'string' },
  'max-chars': { type: 'number', min: 200 },
  'min-chars': { type: 'number', min: 0 },
  'drop-blocks': { type: 'string' },
  contextual: { type: 'string' },
  'contextual-model': { type: 'string' },
  'describe-images': { type: 'string' },
  'embedding-model': { type: 'string' },
  'embedding-dimensions': { type: 'number', min: 1 },
  'image-model': { type: 'string' },
  'extraction-model': { type: 'string' },
} as const satisfies Record<string, FlagSpec>;

const CHUNKING_STRATEGIES = ['structural', 'whole'] as const;

// Live — take effect on the next search, no rebuild.
const RETRIEVAL_FLAGS = {
  rerank: { type: 'string' },
  // Which cross-encoder reranks. Live, not pinned: a reranker runs at query
  // time over text already in the index, so switching costs nothing and is
  // retroactive — unlike the embedding model, which invalidates every vector.
  'rerank-model': { type: 'string' },
  hybrid: { type: 'string' },
  'top-k': { type: 'number', min: 1 },
} as const satisfies Record<string, FlagSpec>;

const CONFIG_FLAGS = {
  ...INGEST_FLAGS,
  ...RETRIEVAL_FLAGS,
} as const satisfies Record<string, FlagSpec>;

export const dataSourcesSpecs = {
  'datasources add': {
    usage:
      'Usage: remy-admin datasources add [--source <slug>] [--metadata <k=v,...>] [--wait] [--timeout <sec>] <file...>',
    positionals: [{ name: 'file', required: true, variadic: true }],
    flags: {
      source: { type: 'string' },
      metadata: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
  'datasources list': {
    usage: 'Usage: remy-admin datasources list',
  },
  'datasources status': {
    usage: 'Usage: remy-admin datasources status [--source <slug>]',
    flags: { source: { type: 'string' } },
  },
  'datasources rm': {
    usage:
      'Usage: remy-admin datasources rm [--source <slug>] (--document <id> | --filter <k=v,...|json>)',
    flags: {
      source: { type: 'string' },
      document: { type: 'string' },
      filter: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['document', 'filter'],
      message:
        'Say what to remove: --document <id> for one document, or --filter <k=v,...|json> for every document that matches.',
    },
  },
  'datasources search': {
    usage:
      'Usage: remy-admin datasources search [--source <slug>] [--top-k <n>] [--mode <hybrid|semantic|lexical>] [--filter <k=v,...|json>] [--phrase <text>] [--contains <words>] [--max-per-document <n>] [--rerank <true|false>] [--hybrid <true|false>] [--highlight] [--candidate] <query>',
    positionals: [{ name: 'query', required: true }],
    flags: {
      source: { type: 'string' },
      'top-k': { type: 'string' },
      candidate: { type: 'boolean' },
      rerank: { type: 'string' },
      hybrid: { type: 'string' },
      mode: { type: 'string' },
      filter: { type: 'string' },
      phrase: { type: 'string' },
      contains: { type: 'string' },
      'max-per-document': { type: 'number', min: 1 },
      highlight: { type: 'boolean' },
    },
  },
  'datasources create': {
    usage:
      'Usage: remy-admin datasources create --source <slug> [--name <name>] [--placement <resource-id|shared>] [ingest settings...]',
    flags: {
      source: { type: 'string' },
      name: { type: 'string' },
      placement: { type: 'string' },
      ...INGEST_FLAGS,
    },
  },
  'datasources config': {
    usage:
      'Usage: remy-admin datasources config [--source <slug>] [--placement <resource-id|shared>] [settings...]',
    flags: {
      source: { type: 'string' },
      // Where the corpus lives: a dedicated resource id from `infra list`, or
      // `shared`. A populated source starts a background move (see `move`).
      placement: { type: 'string' },
      ...CONFIG_FLAGS,
    },
  },
  'datasources move': {
    usage:
      'Usage: remy-admin datasources move [--source <slug>] --to <resource-id|shared> [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      to: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['to'],
      message:
        '--to is required: a resource id from `infra list`, or `shared`.',
    },
  },
  'datasources revectorize': {
    usage:
      'Usage: remy-admin datasources revectorize [--source <slug>] [settings...] [--wait]',
    flags: {
      source: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
      ...CONFIG_FLAGS,
    },
  },
  'datasources promote': {
    usage: 'Usage: remy-admin datasources promote [--source <slug>] [--force]',
    flags: { source: { type: 'string' }, force: { type: 'boolean' } },
  },
  'datasources drop': {
    usage:
      'Usage: remy-admin datasources drop [--source <slug>] [--version <n>]',
    flags: { source: { type: 'string' }, version: { type: 'string' } },
  },
  'datasources delete': {
    usage: 'Usage: remy-admin datasources delete --source <slug>',
    flags: { source: { type: 'string' } },
  },
} satisfies Record<string, CommandSpec>;

/**
 * Add one or more documents.
 *
 * Three steps per file, and the middle one is why this isn't a simple POST:
 * the client hashes the bytes first, so the server can answer "already
 * ingested and current" before anything is transferred. Re-running this over
 * an unchanged corpus moves no bytes and embeds nothing.
 *
 * The upload itself goes straight to storage via a presigned POST, so document
 * size isn't bounded by the API's JSON body limit.
 */
async function dataSourcesAdd(ctx: AdminContext, a: Args) {
  const files = a.rest('file');
  const slug = sourceOf(a);
  const metadata = parseKeyValuePairs(a.str('metadata'), 'metadata');
  const results: dataSources.AddDocumentResult[] = [];

  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.join(WORKSPACE_DIR, file);

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(abs);
    } catch (err: any) {
      fatal(`Could not read file "${file}": ${err.message}`);
    }

    const filename = path.basename(file);
    results.push(
      await dataSources.addDocument(ctx, {
        slug,
        filename,
        content: bytes!,
        ...(metadata ? { metadata } : {}),
        onProgress: progress,
      }),
    );
  }

  if (a.bool('wait')) {
    const timeoutSec = a.num('timeout');
    const timeoutMs = timeoutSec
      ? timeoutSec * 1000
      : dataSources.DEFAULT_WAIT_TIMEOUT_MS;
    const result = await dataSources.waitForIngest(ctx, {
      slug,
      // Every document the files became: a mapped source can make several
      // from one file, or none (a deletes outcome).
      documentIds: results
        .filter((r) => !r.skipped)
        .flatMap((r) => r.documents.map((d) => d.id)),
      timeoutMs,
      onProgress: progress,
    });
    out({
      dataSource: slug,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      documents: result.documents,
    });
    if (result.status === 'timeout') {
      throw new CliError(result.error ?? 'Timed out.', EXIT.timeout);
    }
    if (result.status === 'error') {
      throw new CliError('At least one document failed.', EXIT.buildFailed);
    }
    return;
  }

  out({ dataSource: slug, documents: results });
}

async function dataSourcesList(ctx: AdminContext) {
  out(await dataSources.list(ctx));
}

async function dataSourcesStatus(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const documents = await dataSources.allDocuments(ctx, { slug });
  out({
    dataSource: slug,
    documents: documents.map(dataSources.summarize),
  });
}

async function dataSourcesRm(ctx: AdminContext, a: Args) {
  const documentId = a.str('document');
  const rawFilter = a.str('filter');
  if (documentId && rawFilter) {
    fatal('Give --document or --filter, not both.');
  }
  if (documentId) {
    await dataSources.rm(ctx, { slug: sourceOf(a), documentId });
    out({ deleted: documentId });
    return;
  }
  // `key=value` pairs are metadata equality; a JSON object is the full
  // selector (metadata, filename, documentIds, externalIdPrefix).
  let filter: Record<string, unknown>;
  if (rawFilter!.trimStart().startsWith('{')) {
    try {
      filter = JSON.parse(rawFilter!);
    } catch (err: any) {
      fatal(`--filter is not valid JSON: ${err.message}`);
    }
  } else {
    filter = { metadata: parseKeyValuePairs(rawFilter, 'filter') };
  }
  const slug = sourceOf(a);
  const result = await dataSources.rmWhereAll(ctx, {
    slug,
    filter: filter!,
    onProgress: progress,
  });
  out({ dataSource: slug, filter, ...result });
}

/**
 * Delete a whole data source — every version, every document, every byte.
 *
 * The ONE command where --source is required rather than defaulted: every
 * other command defaulting to "${DEFAULT_SOURCE}" is convenience, but a
 * destructive command silently targeting the default corpus is a foot-gun.
 * Extraction caches survive (shared across sources by content hash), so
 * re-ingesting the same files into a new source costs no re-extraction.
 */
async function dataSourcesDelete(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  if (!slug) {
    fatal(
      '--source is required — deletion never falls back to the default source.',
    );
  }
  const result = await dataSources.deleteSource(ctx, slug);
  out({ dataSource: slug, ...result });
}

async function dataSourcesSearch(ctx: AdminContext, a: Args) {
  const topK = a.num('top-k');
  const retrieval = {
    ...triState(a, 'rerank', 'rerank'),
    ...triState(a, 'hybrid', 'hybrid'),
  };

  const mode = a.str('mode');
  if (mode && !['hybrid', 'semantic', 'lexical'].includes(mode)) {
    fatal(`--mode must be "hybrid", "semantic" or "lexical" (got "${mode}").`);
  }
  const filter = filterFromFlags(a);
  const maxPerDocument = a.num('max-per-document');

  out(
    await dataSources.search(ctx, {
      slug: sourceOf(a),
      query: a.req('query'),
      ...(topK ? { topK } : {}),
      ...(mode ? { mode } : {}),
      ...(filter ? { filter } : {}),
      ...(maxPerDocument !== undefined ? { maxPerDocument } : {}),
      ...(a.bool('highlight') ? { highlight: true } : {}),
      ...(a.bool('candidate') ? { candidate: true } : {}),
      ...(Object.keys(retrieval).length ? { retrieval } : {}),
    }),
  );
}

/**
 * Assemble the search filter from its flags.
 *
 * `--filter` covers the common case as `key=value` metadata equality and the
 * full grammar as a JSON object (`{"pages":{"max":3},...}`) — the same shape
 * the SDK's `SearchFilter` takes. `--phrase`/`--contains` are spelled out as
 * their own flags because required-words is the thing a person actually
 * reaches for at a shell.
 */
function filterFromFlags(a: Args): Record<string, unknown> | undefined {
  let filter: Record<string, unknown> = {};

  const raw = a.str('filter');
  if (raw !== undefined) {
    if (raw.trimStart().startsWith('{')) {
      try {
        filter = JSON.parse(raw);
      } catch (err: any) {
        fatal(`--filter is not valid JSON: ${err.message}`);
      }
    } else {
      const metadata = parseKeyValuePairs(raw, 'filter');
      if (metadata) {
        filter.metadata = metadata;
      }
    }
  }

  const phrase = a.str('phrase');
  if (phrase) {
    filter.phrase = phrase;
  }
  const contains = a.str('contains');
  if (contains) {
    filter.contains = contains;
  }

  return Object.keys(filter).length ? filter : undefined;
}

/**
 * `key=value[,key=value…]` into an object, with scalar coercion.
 *
 * Coercion matters for round-tripping: a document tagged `year: 2026` through
 * the SDK stores a number, and a filter comparing against the string "2026"
 * would silently never match. `true`/`false` and numeric literals therefore
 * become their typed values; quote nothing — there is no string syntax, so a
 * value that must stay the string "2026" needs the JSON form of `--filter`.
 */
function parseKeyValuePairs(
  raw: string | undefined,
  flag: string,
): Record<string, string | number | boolean> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const pairs: Record<string, string | number | boolean> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      fatal(`--${flag} entries must be key=value (got "${trimmed}").`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    pairs[key] =
      value === 'true'
        ? true
        : value === 'false'
          ? false
          : value !== '' && !Number.isNaN(Number(value))
            ? Number(value)
            : value;
  }
  if (Object.keys(pairs).length === 0) {
    fatal(`--${flag} needs at least one key=value pair.`);
  }
  return pairs;
}

/**
 * Read a tri-state boolean flag.
 *
 * Returns `{}` when the flag is absent, so a caller can spread the result and
 * send only what was actually asked for. Without that distinction "don't touch
 * reranking" and "turn reranking off" look identical on the wire.
 */
function triState(a: Args, flag: string, key: string): Record<string, boolean> {
  const raw = a.str(flag);
  if (raw === undefined) {
    return {};
  }
  if (raw !== 'true' && raw !== 'false') {
    fatal(`--${flag} must be "true" or "false" (got "${raw}").`);
  }
  return { [key]: raw === 'true' };
}

/**
 * Split CLI flags into the two halves of the config model.
 *
 * The split isn't cosmetic: `ingest` settings invalidate every stored vector
 * and can only be changed through a re-vectorize, while `retrieval` settings
 * take effect on the next query for free. Keeping them apart on the wire is
 * what lets the server apply one and refuse the other.
 */
function configFromFlags(a: Args): {
  ingest: DataSourcesIngestUpdate | undefined;
  retrieval: DataSourcesRetrievalUpdate | undefined;
} {
  const chunking: NonNullable<DataSourcesIngestUpdate['chunking']> = {};
  const strategy = a.str('chunking');
  if (strategy !== undefined) {
    if (!(CHUNKING_STRATEGIES as readonly string[]).includes(strategy)) {
      fatal(
        `--chunking must be one of: ${CHUNKING_STRATEGIES.join(', ')} (got "${strategy}").`,
      );
    }
    chunking.strategy = strategy as (typeof CHUNKING_STRATEGIES)[number];
  }
  if (a.num('max-chars') !== undefined) {
    chunking.maxChars = a.num('max-chars');
  }
  if (a.num('min-chars') !== undefined) {
    chunking.minChars = a.num('min-chars');
  }
  const dropBlocks = a.str('drop-blocks');
  if (dropBlocks !== undefined) {
    chunking.dropBlockTypes = dropBlocks
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Same two-facet shape as `images` and `rerank`: enabling without a model is
  // fine — the server fills its default chat model rather than leaving the
  // setting inert.
  const contextual = {
    ...triState(a, 'contextual', 'enabled'),
    ...(a.str('contextual-model')
      ? { modelId: a.str('contextual-model') }
      : {}),
  };
  // `describe` and `modelId` are two facets of one `images` object, same shape
  // as `rerank` below. These flags were accepted and silently DROPPED for a
  // while — the exact failure mode the strict arg parser exists to prevent,
  // reintroduced one layer up.
  const images = {
    ...triState(a, 'describe-images', 'describe'),
    ...(a.str('image-model') ? { modelId: a.str('image-model') } : {}),
  };
  const embeddingModel = a.str('embedding-model');
  const embeddingDimensions = a.num('embedding-dimensions');
  const extractionModel = a.str('extraction-model');

  const ingest: DataSourcesIngestUpdate = {};
  if (Object.keys(chunking).length) {
    ingest.chunking = chunking;
  }
  if (Object.keys(contextual).length) {
    ingest.contextual = contextual;
  }
  if (Object.keys(images).length) {
    ingest.images = images;
  }
  if (embeddingModel || embeddingDimensions !== undefined) {
    ingest.embedding = {
      ...(embeddingModel ? { modelId: embeddingModel } : {}),
      ...(embeddingDimensions !== undefined
        ? { dimensions: embeddingDimensions }
        : {}),
    };
  }
  if (extractionModel) {
    ingest.extraction = { modelId: extractionModel };
  }

  const retrieval: DataSourcesRetrievalUpdate = {
    ...triState(a, 'hybrid', 'hybrid'),
  };
  // `enabled` and `modelId` are two facets of one `rerank` object, so they're
  // built together — sending only one of them is fine, because the server
  // merges `rerank` a level deeper rather than replacing it wholesale.
  const rerank = {
    ...triState(a, 'rerank', 'enabled'),
    ...(a.str('rerank-model') ? { modelId: a.str('rerank-model') } : {}),
  };
  if (Object.keys(rerank).length) {
    retrieval.rerank = rerank;
  }
  if (a.num('top-k') !== undefined) {
    retrieval.topK = a.num('top-k');
  }

  return {
    ingest: Object.keys(ingest).length ? ingest : undefined,
    retrieval: Object.keys(retrieval).length ? retrieval : undefined,
  };
}

/** `--placement <resource-id|shared>` as the API takes it; undefined when absent. */
const placementOf = (a: Args) => {
  const flag = a.str('placement');
  return flag === undefined
    ? undefined
    : flag === 'shared'
      ? ('shared' as const)
      : { resourceId: flag };
};

/** The follow-up a response that started a background move deserves. */
const MOVE_NOTE =
  'Moving in the background; `datasources list` shows progress, or re-run with `datasources move --wait`.';

/**
 * Create an empty source, optionally on dedicated capacity. `add` creates a
 * source on first use too, but on the shared pool — so a corpus meant for a
 * resource starts here (or moves later with `move`). An explicit --source,
 * like `delete`: creating "default" by accident helps nobody.
 */
async function dataSourcesCreate(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  if (!slug) {
    fatal('--source is required.');
  }
  const { ingest } = configFromFlags(a);
  const name = a.str('name');
  const placement = placementOf(a);
  const result = await dataSources.create(ctx, {
    slug,
    ...(name ? { name } : {}),
    ...(ingest ? { ingest } : {}),
    ...(placement !== undefined ? { placement } : {}),
  });
  out(
    result.migration && !result.migration.error
      ? { ...result, note: MOVE_NOTE }
      : result,
  );
}

/** Show config, or change it when any setting flag is present. */
async function dataSourcesConfig(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const { ingest, retrieval } = configFromFlags(a);
  const placement = placementOf(a);

  if (!ingest && !retrieval && placement === undefined) {
    out(await dataSources.configGet(ctx, slug));
    return;
  }

  const result = await dataSources.configSet(ctx, {
    slug,
    ...(ingest ? { ingest } : {}),
    ...(retrieval ? { retrieval } : {}),
    ...(placement !== undefined ? { placement } : {}),
  });
  out(
    result.placementChanged && result.migration && !result.migration.error
      ? { ...result, note: MOVE_NOTE }
      : result,
  );
}

/**
 * Move a source between placements. Instant while empty; a populated source
 * is copied onto the target in the background from its stored vectors, and
 * --wait blocks until it lands. Exit codes follow `add --wait`.
 */
async function dataSourcesMove(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const to = a.str('to') as string;
  const placement = to === 'shared' ? ('shared' as const) : { resourceId: to };

  const started = await dataSources.move(ctx, { slug, placement });
  if (!started.migration || !a.bool('wait')) {
    out({
      dataSource: slug,
      ...started,
      ...(started.migration ? { note: MOVE_NOTE } : {}),
    });
    return;
  }

  const timeoutSec = a.num('timeout');
  const result = await dataSources.waitForMove(ctx, {
    slug,
    ...(timeoutSec ? { timeoutMs: timeoutSec * 1000 } : {}),
    onProgress: progress,
  });
  out({
    dataSource: slug,
    status: result.status,
    placement: result.source.placement,
    migration: result.source.migration,
    ...('error' in result ? { error: result.error } : {}),
  });
  if (result.status === 'failed') {
    throw new CliError(result.error, EXIT.buildFailed);
  }
  if (result.status === 'timeout') {
    throw new CliError(result.error, EXIT.timeout);
  }
}

/**
 * Build a new pipeline version alongside the live one.
 *
 * With no settings, adopts the platform's current defaults — the upgrade path
 * for a corpus pinned to an older chunker. Search keeps serving the active
 * version throughout; nothing changes until `promote`.
 */
async function dataSourcesRevectorize(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const { ingest } = configFromFlags(a);

  const started = await dataSources.revectorize(ctx, {
    slug,
    ...(ingest ? { ingest } : {}),
  });

  if (!a.bool('wait')) {
    out({ dataSource: slug, ...started, note: 'Run `promote` when ready.' });
    return;
  }

  const timeoutSec = a.num('timeout');
  const result = await dataSources.waitForCandidate(ctx, {
    slug,
    ...(timeoutSec ? { timeoutMs: timeoutSec * 1000 } : {}),
    onProgress: progress,
  });
  if (result.status === 'timeout') {
    out({ dataSource: slug, status: 'timeout', error: result.error });
    throw new CliError(result.error ?? 'Timed out.', EXIT.timeout);
  }
  out({
    dataSource: slug,
    candidateVersion: started.candidateVersion,
    status: result.status,
    documents: result.documents,
    note:
      result.status === 'error'
        ? 'Some documents failed. Promote with --force to accept, or fix and re-run.'
        : 'Run `promote` to make this version live.',
  });
  if (result.status === 'error') {
    throw new CliError('At least one document failed.', EXIT.buildFailed);
  }
}

async function dataSourcesPromote(ctx: AdminContext, a: Args) {
  out(
    await dataSources.promote(ctx, {
      slug: sourceOf(a),
      ...(a.bool('force') ? { force: true } : {}),
    }),
  );
}

async function dataSourcesDrop(ctx: AdminContext, a: Args) {
  const version = a.str('version');
  out(
    await dataSources.drop(ctx, {
      slug: sourceOf(a),
      ...(version ? { version: Number(version) } : {}),
    }),
  );
}

export const dataSourcesHandlers = {
  'datasources add': dataSourcesAdd,
  'datasources list': dataSourcesList,
  'datasources status': dataSourcesStatus,
  'datasources rm': dataSourcesRm,
  'datasources search': dataSourcesSearch,
  'datasources create': dataSourcesCreate,
  'datasources config': dataSourcesConfig,
  'datasources move': dataSourcesMove,
  'datasources revectorize': dataSourcesRevectorize,
  'datasources promote': dataSourcesPromote,
  'datasources drop': dataSourcesDrop,
  'datasources delete': dataSourcesDelete,
} satisfies Record<keyof typeof dataSourcesSpecs, Handler>;

export const dataSourcesHelp = `remy-admin datasources — Build and query a searchable document corpus.

Documents are parsed, chunked and embedded by the platform. Search returns
matching passages with a citation pointing back at the source document.

Subcommands:
  add          Add one or more documents (skips unchanged files)
  list         List data sources with document counts
  status       Show per-document ingest state
  rm           Remove a document, or every document matching a filter
  search       Query a corpus — useful to sanity-check one you just built
  create       Create an empty source, optionally on dedicated capacity
  config       Show or change how a corpus is processed and searched
  move         Move a corpus between shared and dedicated capacity, data intact
  jobs         Bulk-load a corpus from a file store or a manifest, with a plan first
  connect      Follow an S3 bucket the customer owns (credentials = app secret names)
  sync         Bring a connected source up to date with its bucket
  connector    Show a source's connector and what it tracks
  disconnect   Stop following the bucket; documents stay
  inspect      Profile raw objects (key shapes, types, sizes, JSON keys) before writing a mapper
  map test     Run a source's mapper over real objects and show the outcomes; nothing ingested
  remap        Re-apply the live mapper to every raw copy the source holds
  hydrate      Reload an evicted index ahead of the first search
  sample       Draw a sample of a source into a new one with the same config
  eval         Query sets and runs: measure recall, MRR and latency, compare versions
  revectorize  Rebuild a corpus under new settings, alongside the live one
  promote      Make a rebuilt version live
  drop         Discard a candidate or a superseded version
  delete       Delete a whole data source — documents, vectors and versions

Usage:
  remy-admin datasources add [--source <slug>] [--metadata <k=v,...>] [--wait] [--timeout <sec>] <file...>
  remy-admin datasources list
  remy-admin datasources status [--source <slug>]
  remy-admin datasources rm [--source <slug>] (--document <id> | --filter <k=v,...|json>)
  remy-admin datasources search [--source <slug>] [search options] <query>
  remy-admin datasources create --source <slug> [--name <name>] [--placement <resource-id|shared>] [rebuild settings...]
  remy-admin datasources config [--source <slug>] [--placement <resource-id|shared>] [settings...]
  remy-admin datasources move [--source <slug>] --to <resource-id|shared> [--wait] [--timeout <sec>]
  remy-admin datasources jobs start|list|status|approve|pause|resume|cancel … (see below)
  remy-admin datasources connect|sync|connector|disconnect … (see below)
  remy-admin datasources hydrate|sample … (see below)
  remy-admin datasources eval create|list|get|add|import|queries|rm|delete|run|runs|result|compare … (see below)
  remy-admin datasources revectorize [--source <slug>] [settings...] [--wait]
  remy-admin datasources promote [--source <slug>] [--force]
  remy-admin datasources drop [--source <slug>] [--version <n>]
  remy-admin datasources delete --source <slug>

Search options:
  --top-k <n>              Results to return (default 5, max 50)
  --mode <m>               hybrid (default) | semantic | lexical. Lexical is
                           keyword-only — no query embedding, fastest, right
                           for identifiers like error codes or SKUs.
  --filter <k=v,...>       Match document metadata set at add time. Values
                           coerce: true/false and numbers become typed.
                           Pass a JSON object for the full grammar:
                           metadata, filename, documentIds, pages, contains,
                           phrase — e.g. --filter '{"pages":{"max":3}}'.
                           Metadata takes numeric ranges via {gte,lte}: store
                           dates as integers (YYYYMMDD or epoch seconds), then
                           --filter '{"metadata":{"date":{"gte":20250101}}}'
  --phrase <text>          Chunk must contain this exact word sequence
  --contains <words>       Chunk must contain ALL these words, any order
  --max-per-document <n>   Cap hits per document; backfills from others
  --rerank <true|false>    Override reranking for this query
  --hybrid <true|false>    Same as --mode semantic when false
  --highlight              Offsets of the query's most distinctive terms per hit
  --candidate              Search the candidate version instead of the live one

Tuning a corpus:
  There is no single chunking or retrieval setup that suits every dataset, so
  these are yours to change. Settings come in two kinds, and the difference is
  what a change costs you:

  FREE — take effect on the next search, no rebuild:
    --rerank <true|false>    Cross-encoder reranking (default true)
    --rerank-model <id>      Which cross-encoder reranks (live, no rebuild)
    --hybrid <true|false>    Semantic + keyword matching (default true)
    --top-k <n>              Default results per search

  REBUILD — change how documents become vectors, so existing documents must be
  reprocessed. Changing these on a corpus that already has documents is
  REJECTED; use \`revectorize\` instead, which builds a new version alongside
  the live one so search never degrades:
    --chunking <structural|whole>
                             structural (default) splits on headings, blocks
                             and paragraphs. whole embeds each document as one
                             chunk: for corpora of short records (articles,
                             tickets, product rows) where the document is the
                             unit you want back. Documents over --max-chars
                             (default 24000 for whole) fall back to structural.
    --max-chars <n>          Target chunk size (default 2000)
    --min-chars <n>          Merge chunks smaller than this (default 120)
    --drop-blocks <a,b>      Block types to discard, e.g. footer,header
    --contextual <true|false>  LLM context blurb per chunk. Improves retrieval
                             on long documents; costs a model call per chunk
                             at ingest. Off by default — measure on your data.
    --contextual-model <id>  Which chat model writes the blurbs. Optional:
                             enabling without it uses the platform default.
    --describe-images <true|false>  Vision pass over images inside documents,
                             substituting a description into the searchable
                             text. ON by default: a document with no images
                             costs nothing, and an undescribed chart is
                             invisible to search rather than merely ranked low.
    --image-model <id>
    --embedding-model <id>
    --embedding-dimensions <n>  Vector width, for models that offer several
                             (Matryoshka). Must be the model's native size or
                             one it lists; the error names the choices.
                             Smaller vectors cut index memory, and dedicated
                             capacity needs, roughly in proportion.
    --extraction-model <id>

Placement (shared pool vs dedicated capacity, see \`infra --help\`):
  --source defaults to "${DEFAULT_SOURCE}" and is created on first use, on the
    shared pool. Start a corpus on a resource with \`create --placement\`, or
    move one at any time with \`move --to <resource-id|shared>\`.
  A move copies the corpus's stored vectors onto the new capacity in the
    background: no re-extraction, no re-embedding, no charge beyond the
    resource itself. Search keeps working from the old placement until the
    copy lands; add, rm, config, revectorize and delete are refused with
    data_source_migrating until then. \`datasources list\` shows progress;
    \`move --wait\` blocks on it (exits ${EXIT.buildFailed} if the move failed,
    ${EXIT.timeout} on timeout). Moving to \`shared\` is how a source leaves a
    resource you mean to destroy.
  A move is refused while documents are still building or a candidate version
    exists (data_source_busy), when the target is not active
    (capacity_<phase>), or when it would not fit (capacity_exceeded).

Notes:
  --wait blocks until processing finishes, so you can search immediately after.
    Exits ${EXIT.buildFailed} if a document failed, ${EXIT.timeout} on timeout.
  Re-adding an unchanged file is free: no upload, no re-embedding. Re-adding
    with a different --metadata updates the tags in place, also free.
  --metadata tags documents for search-time filtering (scalars, ≤16 keys).
  rm --filter removes every matching document in pages of a thousand: k=v
    pairs match metadata; a JSON object takes the full selector — metadata,
    filename, documentIds, externalIdPrefix (the key a job or connector
    recorded, e.g. '{"externalIdPrefix":"archive/2019/"}'). An empty filter
    is refused; to remove everything, delete the source.
  delete requires an explicit --source (no default) and refuses while documents
    are still ingesting. Extraction caches survive deletion, so re-ingesting
    the same files elsewhere costs no re-extraction.
  Re-vectorizing reuses stored extractions, so changing chunking never re-runs
  document extraction — only re-chunking and re-embedding.

Examples:
  remy-admin datasources add --source policies --wait docs/*.pdf
  remy-admin datasources add --source policies --metadata department=legal,year=2026 contract.pdf
  remy-admin datasources search --source policies "what are the payment terms?"
  remy-admin datasources search --source policies --filter department=legal --phrase "notice period" "termination"
  remy-admin datasources search --source policies --mode lexical "ERR-7741X"

  # Try smaller chunks without touching what's live, then compare and cut over
  remy-admin datasources revectorize --source policies --max-chars 900 --wait
  remy-admin datasources search --source policies --candidate "payment terms"
  remy-admin datasources promote --source policies

  # Load a whole corpus: plan first, approve, watch it run
  remy-admin datasources jobs start --source archive --store raw --prefix 2024/ --wait
  remy-admin datasources jobs approve <id> --wait

  # Follow a customer's bucket: secrets by name, first sync stops for approval
  remy-admin secrets set ARCHIVE_S3_KEY --prod <value>      # never on a command line you share
  remy-admin datasources connect --source archive --bucket acme-docs --region us-east-1 --prefix contracts/ --access-key-secret ARCHIVE_S3_KEY --secret-key-secret ARCHIVE_S3_SECRET --budget-per-sync 5
  remy-admin datasources sync --source archive --wait

  # Measure before you promote: sample, build a query set, run live vs candidate
  remy-admin datasources sample --source archive --size 300 --wait
  remy-admin datasources eval create --source archive-sample --name base --size 150 --wait
  remy-admin datasources eval run --set <setId> --label live --wait
  remy-admin datasources revectorize --source archive-sample --max-chars 900 --wait
  remy-admin datasources eval run --set <setId> --candidate --label small-chunks --wait
  remy-admin datasources eval compare <runA> <runB>
${dataSourceJobsHelp}${dataSourceConnectorsHelp}${dataSourceMappersHelp}${dataSourceEvalsHelp}`;
