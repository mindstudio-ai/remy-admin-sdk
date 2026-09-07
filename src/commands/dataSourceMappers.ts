/**
 * CLI skin for data-source mappers: inspect raw objects, test a mapper, remap
 * after a fix, read and replay a job's quarantine. Operations live in
 * ../ops/dataSourceMappers.js; response shapes in ../types/dataSourceMappers.js.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { CliError, EXIT, fatal } from '../errors.js';
import * as mappers from '../ops/dataSourceMappers.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';
import { sourceOf, waitAndReport } from './_shared/dataSources.js';

const SELECTION_FLAGS = {
  store: { type: 'string' },
  access: { type: 'string' },
  prefix: { type: 'string' },
  connector: { type: 'boolean' },
  keys: { type: 'string' },
} as const;

export const dataSourceMappersSpecs = {
  'datasources inspect': {
    usage:
      'Usage: remy-admin datasources inspect [--source <slug>] (--store <name> [--access <private|public>] [--prefix <p>] | --connector) [--keys k1,k2,...] [--limit <n>]',
    flags: {
      source: { type: 'string' },
      ...SELECTION_FLAGS,
      limit: { type: 'number', min: 1 },
    },
    requireAnyOf: {
      flags: ['store', 'connector'],
      message:
        "Name the objects: --store <name> [--prefix <p>], or --connector for the source's bucket.",
    },
  },
  'datasources map test': {
    usage:
      'Usage: remy-admin datasources map test [--source <slug>] (--store <name> [--access <private|public>] [--prefix <p>] | --connector) [--keys k1,k2,...] [--limit <n>] [--dev] [--full]',
    flags: {
      source: { type: 'string' },
      ...SELECTION_FLAGS,
      limit: { type: 'number', min: 1 },
      dev: { type: 'boolean' },
      full: { type: 'boolean' },
    },
    requireAnyOf: {
      flags: ['store', 'connector'],
      message:
        "Name the objects: --store <name> [--prefix <p>], or --connector for the source's bucket.",
    },
  },
  'datasources remap': {
    usage:
      'Usage: remy-admin datasources remap [--source <slug>] [--budget <dollars>] [--limit <n>] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      budget: { type: 'number', min: 0.01 },
      limit: { type: 'number', min: 1 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
  'datasources jobs quarantine': {
    usage:
      'Usage: remy-admin datasources jobs quarantine <id> [--kind skip|error] [--reason <text>] [--cursor <id>] [--limit <n>]',
    positionals: [{ name: 'id', required: true }],
    flags: {
      kind: { type: 'string' },
      reason: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'number', min: 1 },
    },
  },
  'datasources jobs replay': {
    usage:
      'Usage: remy-admin datasources jobs replay <id> [--kind skip|error] [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: {
      kind: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
} satisfies Record<string, CommandSpec>;

function selectionOf(a: Args): mappers.ObjectSelection {
  const store = a.str('store');
  if (a.bool('connector') && store) {
    fatal('Give --store or --connector, not both.');
  }
  if (a.bool('connector')) {
    return { connector: true };
  }
  const access = a.str('access') ?? 'private';
  if (access !== 'private' && access !== 'public') {
    fatal(`--access must be "private" or "public" (got "${access}").`);
  }
  return {
    store: store as string,
    access: access as 'private' | 'public',
    ...(a.str('prefix') !== undefined ? { prefix: a.str('prefix') } : {}),
  };
}

function keysOf(a: Args): string[] | undefined {
  const raw = a.str('keys');
  if (!raw) {
    return undefined;
  }
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    fatal('--keys needs at least one key.');
  }
  return keys;
}

function kindOf(a: Args): 'skip' | 'error' | undefined {
  const kind = a.str('kind');
  if (kind === undefined) {
    return undefined;
  }
  if (kind !== 'skip' && kind !== 'error') {
    fatal(`--kind must be "skip" or "error" (got "${kind}").`);
  }
  return kind as 'skip' | 'error';
}

async function inspect(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  const selection = selectionOf(a);
  if ('connector' in selection && !slug) {
    fatal("--connector needs --source: the bucket is the source's.");
  }
  const limit = a.num('limit');
  const result = await mappers.inspect(ctx, {
    ...(slug ? { slug } : {}),
    selection,
    ...(keysOf(a) ? { keys: keysOf(a) } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  out({
    ...(slug ? { dataSource: slug } : {}),
    ...result,
    note: result.report.truncated
      ? `Listed the first ${result.report.objects.toLocaleString()} objects; raise --limit to see more of the shape.`
      : `Listed every object (${result.report.objects.toLocaleString()}).`,
  });
}

async function mapTest(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const limit = a.num('limit');
  const result = await mappers.mapTest(ctx, {
    slug,
    selection: selectionOf(a),
    ...(keysOf(a) ? { keys: keysOf(a) } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(a.bool('dev') ? { dev: true } : {}),
  });
  // Previews are the point of a test, but two hundred of them drown the
  // summary; --full keeps every one.
  const results = a.bool('full')
    ? result.results
    : result.results.map((r) =>
        r.outcome.kind === 'documents'
          ? {
              ...r,
              outcome: {
                ...r.outcome,
                documents: r.outcome.documents.map((d) => ({
                  ...d,
                  preview: d.preview.slice(0, 200),
                })),
              },
            }
          : r,
      );
  out({
    dataSource: slug,
    ...result,
    results,
    note: result.dev
      ? 'Ran the LOCAL mapper through the dev session. Nothing was ingested; deploy to make it live.'
      : "Ran the live release's mapper. Nothing was ingested.",
  });
  if (result.counts.error > 0) {
    throw new CliError(
      `${result.counts.error} of ${result.objects} object(s) errored in the mapper.`,
      EXIT.buildFailed,
    );
  }
}

async function remap(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const budget = a.num('budget');
  const limit = a.num('limit');
  const { job, mapper } = await mappers.remap(ctx, {
    slug,
    ...(budget !== undefined ? { budgetDollars: budget } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  if (!a.bool('wait')) {
    out({
      dataSource: slug,
      job,
      mapper,
      note: 'Remapping from the raw copies. Poll `datasources jobs status <id>`, or re-run with --wait. Unchanged documents are skipped by hash; changed ones supersede their predecessors.',
    });
    return;
  }
  await waitAndReport(ctx, a, job.id, 'job', {
    dataSource: slug,
    action: 'remap',
    mapper,
  });
}

async function quarantine(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const limit = a.num('limit');
  const kind = kindOf(a);
  const reason = a.str('reason');
  const cursor = a.str('cursor');
  const result = await mappers.quarantine(ctx, {
    id,
    ...(kind ? { kind } : {}),
    ...(reason ? { reason } : {}),
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  out({
    ...result,
    note:
      result.counts.skipped + result.counts.errors === 0
        ? 'Nothing quarantined: the mapper produced documents (or deletions) for every object.'
        : `Fix the mapper, deploy, then \`datasources jobs replay ${id}\` to run these through it again.`,
  });
}

async function replay(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const kind = kindOf(a);
  const { job, mapper, dataSource } = await mappers.replay(ctx, {
    id,
    ...(kind ? { kind } : {}),
  });
  if (!a.bool('wait')) {
    out({
      dataSource: dataSource.slug,
      fromJob: id,
      job,
      mapper,
      note: 'Replaying the quarantined objects through the current mapper. Poll `datasources jobs status <id>`, or re-run with --wait.',
    });
    return;
  }
  await waitAndReport(ctx, a, job.id, 'job', {
    dataSource: dataSource.slug,
    fromJob: id,
    action: 'replay',
    mapper,
  });
}

export const dataSourceMappersHandlers = {
  'datasources inspect': inspect,
  'datasources map test': mapTest,
  'datasources remap': remap,
  'datasources jobs quarantine': quarantine,
  'datasources jobs replay': replay,
} satisfies Record<keyof typeof dataSourceMappersSpecs, Handler>;

/** Appended to the datasources group help. */
export const dataSourceMappersHelp = `
Mapping raw objects into documents (mappers):
  remy-admin datasources inspect [--source <slug>] (--store <name> [--prefix <p>] | --connector) [--keys k1,k2] [--limit <n>]
  remy-admin datasources map test [--source <slug>] (--store <name> [--prefix <p>] | --connector) [--keys k1,k2] [--limit <n>] [--dev] [--full]
  remy-admin datasources remap [--source <slug>] [--budget <dollars>] [--limit <n>] [--wait] [--timeout <sec>]
  remy-admin datasources jobs quarantine <id> [--kind skip|error] [--reason <text>] [--cursor <id>] [--limit <n>]
  remy-admin datasources jobs replay <id> [--kind skip|error] [--wait] [--timeout <sec>]

  A source takes every object it is given as one document. When the file is
  not the document — JSON records that should become markdown plus metadata,
  a JSONL object holding many articles, a kill notice that means "remove this
  story" — the app declares a MAPPER for the source in mindstudio.json:
    "dataSources": [{ "slug": "archive", "mapper": { "path": "dist/datasources/archive.mapper.ts" } }]
  The file exports defineMapper(Archive, { map }) from @mindstudio-ai/agent.
  map(object) reads the raw object (object.key, .bytes(), .text(), .json())
  and answers documents([{ externalId, title, markdown, metadata?, replaces? }]),
  passthrough() (ingest the raw object as-is), skip(reason) or
  deletes([externalId, ...]); throwing is the object's error. It may call
  models or fetch — every call is spend per object. Everything entering a
  mapped source is mapped: jobs, syncs and Source.add() alike.

  The loop: \`inspect\` profiles the objects (key shapes, extensions, sizes,
  JSON key signatures of ten sampled heads) before a line is written;
  \`map test --dev\` runs the LOCAL mapper through the running dev session
  over real objects and prints every outcome without ingesting anything;
  deploy; a job or sync runs the compiled mapper; \`jobs quarantine <id>\`
  lists what it skipped or failed on, by reason; fix, deploy, \`jobs replay
  <id>\` runs just those objects again; \`remap\` re-applies a changed mapper
  to every raw copy the source holds — no origin traffic, unchanged markdown
  skipped by hash, changed documents superseding their predecessors.

  externalId is the identity the platform replaces by: a later object
  producing the same id supersedes the earlier document; \`replaces\` names
  ids this document supersedes (a writethru's original); deletes([...])
  removes by id. A plan on a mapped source records the mapper's outcome mix
  on its sample; a run whose skip share climbs past twice that (floor 5%)
  pauses with pauseReason 'skips' for a look at the quarantine.
`;
