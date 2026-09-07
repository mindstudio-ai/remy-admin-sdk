/**
 * CLI skin for `datasources hydrate`, `datasources sample` and the nested
 * `datasources eval` group. Operations live in ../ops/dataSourceEvals.js;
 * response shapes in ../types/dataSourceEvals.js.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type Args, type CommandSpec } from '../args.js';
import { WORKSPACE_DIR } from '../config.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as evals from '../ops/dataSourceEvals.js';
import type { QueryInput } from '../ops/dataSourceEvals.js';
import { out, progress } from '../output.js';
import type { Handler } from '../types.js';
import type { EvalRetrieval } from '../types/dataSourceEvals.js';
import {
  DEFAULT_SOURCE,
  failOnWait,
  timeoutOf,
  waitAndReport,
} from './_shared/dataSources.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dataSourceEvalsSpecs = {
  'datasources hydrate': {
    usage:
      'Usage: remy-admin datasources hydrate [--source <slug>] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
  'datasources sample': {
    usage:
      'Usage: remy-admin datasources sample --source <slug> --size <n> [--as <slug>] [--filter <k=v,...|json>] [--stratify <metadata-key>] [--placement <resource-id|shared>] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      size: { type: 'number', min: 1 },
      as: { type: 'string' },
      filter: { type: 'string' },
      stratify: { type: 'string' },
      placement: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['size'],
      message: '--size <n> is required (documents to draw, up to 2000).',
    },
  },
  'datasources eval create': {
    usage:
      'Usage: remy-admin datasources eval create --source <slug> --name <name> [--size <n>] [--style cloze|question] [--model <id>] [--tags <a,b>] [--description <text>] [--seed <n>] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      name: { type: 'string' },
      size: { type: 'number', min: 0 },
      style: { type: 'string' },
      model: { type: 'string' },
      tags: { type: 'string' },
      description: { type: 'string' },
      seed: { type: 'number', min: 0 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: { flags: ['name'], message: '--name is required.' },
  },
  'datasources eval list': {
    usage: 'Usage: remy-admin datasources eval list [--source <slug>]',
    flags: { source: { type: 'string' } },
  },
  'datasources eval get': {
    usage: 'Usage: remy-admin datasources eval get <setId> [--queries]',
    positionals: [{ name: 'id', required: true }],
    flags: { queries: { type: 'boolean' } },
  },
  'datasources eval delete': {
    usage: 'Usage: remy-admin datasources eval delete <setId>',
    positionals: [{ name: 'id', required: true }],
  },
  'datasources eval add': {
    usage:
      'Usage: remy-admin datasources eval add --set <id> --query <text> (--expect <ref,...> | --expect-file <name,...> | --expect-external <id,...>) [--passage <text>] [--tags <a,b>]',
    flags: {
      set: { type: 'string' },
      query: { type: 'string' },
      expect: { type: 'string' },
      'expect-file': { type: 'string' },
      'expect-external': { type: 'string' },
      passage: { type: 'string' },
      tags: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['expect', 'expect-file', 'expect-external'],
      message:
        'Say which document should come back: --expect <documentId|filename|externalId,...>, --expect-file <filename,...> or --expect-external <externalId,...>.',
    },
  },
  'datasources eval import': {
    usage: 'Usage: remy-admin datasources eval import --set <id> <file.jsonl>',
    positionals: [{ name: 'file', required: true }],
    flags: { set: { type: 'string' } },
  },
  'datasources eval queries': {
    usage: 'Usage: remy-admin datasources eval queries --set <id>',
    flags: { set: { type: 'string' } },
  },
  'datasources eval rm': {
    usage: 'Usage: remy-admin datasources eval rm --set <id> <queryId>',
    positionals: [{ name: 'queryId', required: true }],
    flags: { set: { type: 'string' } },
  },
  'datasources eval run': {
    usage:
      'Usage: remy-admin datasources eval run --set <id> [--source <slug>] [--candidate] [--label <text>] [--mode hybrid|semantic|lexical] [--rerank true|false] [--rerank-model <id>] [--candidates <n>] [--hybrid true|false] [--top-k <n>] [--wait] [--timeout <sec>]',
    flags: {
      set: { type: 'string' },
      source: { type: 'string' },
      candidate: { type: 'boolean' },
      label: { type: 'string' },
      mode: { type: 'string' },
      rerank: { type: 'string' },
      'rerank-model': { type: 'string' },
      candidates: { type: 'number', min: 1 },
      hybrid: { type: 'string' },
      'top-k': { type: 'number', min: 1 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: { flags: ['set'], message: '--set <id> is required.' },
  },
  'datasources eval runs': {
    usage:
      'Usage: remy-admin datasources eval runs [--set <id>] [--source <slug>]',
    flags: { set: { type: 'string' }, source: { type: 'string' } },
  },
  'datasources eval result': {
    usage:
      'Usage: remy-admin datasources eval result <runId> [--queries] [--worst <n>]',
    positionals: [{ name: 'id', required: true }],
    flags: { queries: { type: 'boolean' }, worst: { type: 'number', min: 1 } },
  },
  'datasources eval compare': {
    usage: 'Usage: remy-admin datasources eval compare <runA> <runB>',
    positionals: [
      { name: 'a', required: true },
      { name: 'b', required: true },
    ],
  },
} satisfies Record<string, CommandSpec>;

const requireSet = (a: Args): string => {
  const id = a.str('set');
  if (!id) {
    fatal('--set <id> is required.');
  }
  return id as string;
};

const splitList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const triState = (a: Args, flag: string): boolean | undefined => {
  const raw = a.str(flag);
  if (raw === undefined) {
    return undefined;
  }
  if (raw !== 'true' && raw !== 'false') {
    fatal(`--${flag} must be "true" or "false" (got "${raw}").`);
  }
  return raw === 'true';
};

/** `key=value` pairs → metadata equality; a JSON object → the full selector. */
function selectorFromFlag(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.trimStart().startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch (err: any) {
      fatal(`--filter is not valid JSON: ${err.message}`);
    }
  }
  const metadata: Record<string, string | number | boolean> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      fatal(`--filter entries must be key=value (got "${trimmed}").`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    metadata[key] =
      value === 'true'
        ? true
        : value === 'false'
          ? false
          : value !== '' && !Number.isNaN(Number(value))
            ? Number(value)
            : value;
  }
  return { metadata };
}

// ─── hydrate / sample ────────────────────────────────────────────────────────

async function hydrate(ctx: AdminContext, a: Args) {
  const slug = a.str('source') || DEFAULT_SOURCE;
  const started = await evals.hydrate(ctx, { slug });
  if (started.resident || !a.bool('wait')) {
    out({
      dataSource: slug,
      ...started,
      ...(started.resident
        ? { note: 'The index is already loaded.' }
        : {
            note: 'Loading in the background. `datasources list` shows progress; re-run with --wait to block.',
          }),
    });
    return;
  }
  const result = await evals.waitForHydration(ctx, {
    slug,
    ...timeoutOf(a),
    onProgress: progress,
  });
  out({ dataSource: slug, action: 'hydrate', ...result });
  failOnWait(result);
}

async function sampleCmd(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  if (!slug) {
    fatal('--source is required — a sample is drawn from one named source.');
  }
  const placementRaw = a.str('placement');
  const placement =
    placementRaw === undefined
      ? undefined
      : placementRaw === 'shared'
        ? ('shared' as const)
        : { resourceId: placementRaw };
  const result = await evals.sample(ctx, {
    slug: slug as string,
    size: a.num('size') as number,
    ...(a.str('as') ? { as: a.str('as') } : {}),
    ...(a.str('filter') ? { filter: selectorFromFlag(a.str('filter')) } : {}),
    ...(a.str('stratify') ? { stratify: a.str('stratify') } : {}),
    ...(placement !== undefined ? { placement } : {}),
  });
  if (!a.bool('wait')) {
    out({
      ...result,
      note: `Sampling into "${result.dataSource.slug}". Poll \`datasources jobs status ${result.job.id}\` or re-run with --wait.`,
    });
    return;
  }
  await waitAndReport(ctx, a, result.job.id, 'job', {
    dataSource: result.dataSource,
    action: 'sample',
  });
}

// ─── sets ────────────────────────────────────────────────────────────────────

async function evalCreate(ctx: AdminContext, a: Args) {
  const slug = a.str('source') || DEFAULT_SOURCE;
  const style = a.str('style');
  if (style && style !== 'cloze' && style !== 'question') {
    fatal(`--style must be "cloze" or "question" (got "${style}").`);
  }
  const size = a.num('size');
  const seed = a.num('seed');
  const { set } = await evals.createSet(ctx, {
    slug,
    name: a.str('name') as string,
    ...(a.str('description') ? { description: a.str('description') } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(style ? { style: style as 'cloze' | 'question' } : {}),
    ...(a.str('model') ? { modelId: a.str('model') } : {}),
    ...(a.str('tags') ? { tags: splitList(a.str('tags')) } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });
  const generating = set.state === 'queued' || set.state === 'generating';
  if (!generating || !a.bool('wait')) {
    out({
      dataSource: slug,
      set,
      note: generating
        ? 'Generating in the background. `datasources eval get <id>` shows the state; re-run with --wait to block.'
        : 'Empty set. Add queries with `datasources eval add` or `eval import`.',
    });
    return;
  }
  const result = await evals.waitForSet(ctx, {
    id: set.id,
    ...timeoutOf(a),
    onProgress: progress,
  });
  out({ dataSource: slug, action: 'create', ...result });
  failOnWait(result);
}

async function evalList(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  out(await evals.listSets(ctx, slug ? { slug } : undefined));
}

async function evalGet(ctx: AdminContext, a: Args) {
  out(
    await evals.getSet(ctx, {
      id: a.req('id'),
      ...(a.bool('queries') ? { queries: true } : {}),
    }),
  );
}

async function evalDelete(ctx: AdminContext, a: Args) {
  out(await evals.deleteSet(ctx, { id: a.req('id') }));
}

// ─── queries ─────────────────────────────────────────────────────────────────

/** Classify loose references: UUIDs are ids, names with a dot are filenames, the rest external ids. */
function expectFromFlags(a: Args): QueryInput['expect'] {
  const expect: QueryInput['expect'] = {};
  for (const ref of splitList(a.str('expect'))) {
    if (UUID_RE.test(ref)) {
      (expect.documentIds ??= []).push(ref);
    } else if (ref.includes('.')) {
      (expect.filenames ??= []).push(ref);
    } else {
      (expect.externalIds ??= []).push(ref);
    }
  }
  for (const name of splitList(a.str('expect-file'))) {
    (expect.filenames ??= []).push(name);
  }
  for (const id of splitList(a.str('expect-external'))) {
    (expect.externalIds ??= []).push(id);
  }
  return expect;
}

async function evalAdd(ctx: AdminContext, a: Args) {
  const id = requireSet(a);
  const query = a.str('query');
  if (!query) {
    fatal('--query is required.');
  }
  const result = await evals.addQueries(ctx, {
    id,
    queries: [
      {
        query: query as string,
        expect: expectFromFlags(a),
        ...(a.str('passage') ? { passage: a.str('passage') } : {}),
        ...(a.str('tags') ? { tags: splitList(a.str('tags')) } : {}),
      },
    ],
  });
  out({ set: id, ...result });
}

async function evalImport(ctx: AdminContext, a: Args) {
  const id = requireSet(a);
  const file = a.req('file');
  const abs = path.isAbsolute(file) ? file : path.join(WORKSPACE_DIR, file);
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (err: any) {
    fatal(`Could not read "${file}": ${err.message}`);
  }
  const rows: QueryInput[] = [];
  content!.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fatal(`${file}:${i + 1} is not valid JSON.`);
    }
    if (
      typeof parsed?.query !== 'string' ||
      typeof parsed?.expect !== 'object'
    ) {
      fatal(
        `${file}:${i + 1} needs { "query": "...", "expect": { "filenames" | "documentIds" | "externalIds" | "contentHashes": [...] } }.`,
      );
    }
    rows.push(parsed as QueryInput);
  });
  if (rows.length === 0) {
    fatal(`"${file}" has no queries.`);
  }
  let added = 0;
  let queryCount = 0;
  for (let i = 0; i < rows.length; i += 500) {
    progress(`importing ${Math.min(i + 500, rows.length)}/${rows.length}…`);
    const result = await evals.addQueries(ctx, {
      id,
      queries: rows.slice(i, i + 500),
    });
    added += result.added;
    queryCount = result.queryCount;
  }
  out({ set: id, added, queryCount });
}

async function evalQueries(ctx: AdminContext, a: Args) {
  out(await evals.listQueries(ctx, { id: requireSet(a) }));
}

async function evalRm(ctx: AdminContext, a: Args) {
  out(
    await evals.deleteQuery(ctx, {
      id: requireSet(a),
      queryId: a.req('queryId'),
    }),
  );
}

// ─── runs ────────────────────────────────────────────────────────────────────

async function evalRun(ctx: AdminContext, a: Args) {
  const mode = a.str('mode');
  if (mode && !['hybrid', 'semantic', 'lexical'].includes(mode)) {
    fatal(`--mode must be "hybrid", "semantic" or "lexical" (got "${mode}").`);
  }
  const rerank = triState(a, 'rerank');
  const hybrid = triState(a, 'hybrid');
  const rerankModel = a.str('rerank-model');
  const candidates = a.num('candidates');
  const topK = a.num('top-k');
  const retrieval: EvalRetrieval = {
    ...(mode ? { mode: mode as EvalRetrieval['mode'] } : {}),
    ...(hybrid !== undefined ? { hybrid } : {}),
    ...(rerank !== undefined || rerankModel || candidates !== undefined
      ? {
          rerank: {
            ...(rerank !== undefined ? { enabled: rerank } : {}),
            ...(rerankModel ? { modelId: rerankModel } : {}),
            ...(candidates !== undefined ? { candidates } : {}),
          },
        }
      : {}),
    ...(topK !== undefined ? { topK } : {}),
  };
  const { run } = await evals.run(ctx, {
    setId: a.str('set') as string,
    ...(a.str('source') ? { slug: a.str('source') } : {}),
    ...(a.bool('candidate') ? { candidate: true } : {}),
    ...(a.str('label') ? { label: a.str('label') } : {}),
    retrieval,
  });
  if (!a.bool('wait')) {
    out({
      run,
      note: 'Running in the background. `datasources eval result <id>` shows the numbers when it is done; re-run with --wait to block.',
    });
    return;
  }
  const result = await evals.waitForRun(ctx, {
    id: run.id,
    ...timeoutOf(a),
    onProgress: progress,
  });
  out({ action: 'run', ...result });
  failOnWait(result);
}

async function evalRuns(ctx: AdminContext, a: Args) {
  const setId = a.str('set');
  const slug = a.str('source');
  out(
    await evals.listRuns(ctx, {
      ...(setId ? { setId } : {}),
      ...(slug ? { slug } : {}),
    }),
  );
}

async function evalResult(ctx: AdminContext, a: Args) {
  const worst = a.num('worst');
  out(
    await evals.getRun(ctx, {
      id: a.req('id'),
      ...(a.bool('queries') ? { queries: true } : {}),
      ...(worst !== undefined ? { worst } : {}),
    }),
  );
}

async function evalCompare(ctx: AdminContext, a: Args) {
  out(await evals.compare(ctx, { a: a.req('a'), b: a.req('b') }));
}

export const dataSourceEvalsHandlers = {
  'datasources hydrate': hydrate,
  'datasources sample': sampleCmd,
  'datasources eval create': evalCreate,
  'datasources eval list': evalList,
  'datasources eval get': evalGet,
  'datasources eval delete': evalDelete,
  'datasources eval add': evalAdd,
  'datasources eval import': evalImport,
  'datasources eval queries': evalQueries,
  'datasources eval rm': evalRm,
  'datasources eval run': evalRun,
  'datasources eval runs': evalRuns,
  'datasources eval result': evalResult,
  'datasources eval compare': evalCompare,
} satisfies Record<keyof typeof dataSourceEvalsSpecs, Handler>;

/** Appended to the datasources group help. */
export const dataSourceEvalsHelp = `
Warming and sampling:
  remy-admin datasources hydrate [--source <slug>] [--wait]
  remy-admin datasources sample --source <slug> --size <n> [--as <slug>] [--filter <k=v,...|json>] [--stratify <key>] [--placement <id|shared>] [--wait]

  A large source whose index was evicted (the shared pool holds a working set,
  not everything) answers searches with index_warming while it reloads in the
  background; small sources reload inside the search and never show it.
  \`hydrate\` starts that reload ahead of time — before a demo, say — and
  \`--wait\` blocks until the index is back. \`datasources list\` shows the
  reload's progress under \`hydration\`.

  \`sample\` draws documents from a source into a new one that shares its
  exact pinned config, so what you measure on the sample says something about
  the parent. Uniform by default; --stratify <metadata key> takes each value
  in proportion; --filter scopes the draw. It runs as a job (auto-approved;
  extraction is reused, so the plan is chunk + embed only). Documents keep
  their content hashes, which is what lets a query set built on the sample
  score the parent as well. Up to 2,000 documents.

Retrieval evals:
  remy-admin datasources eval create --source <slug> --name <name> [--size <n>] [--style cloze|question] [--model <id>] [--tags <a,b>] [--wait]
  remy-admin datasources eval list [--source <slug>]
  remy-admin datasources eval get <setId> [--queries]
  remy-admin datasources eval add --set <id> --query <text> --expect <ref,...> [--passage <text>] [--tags <a,b>]
  remy-admin datasources eval import --set <id> <file.jsonl>
  remy-admin datasources eval queries --set <id>
  remy-admin datasources eval rm --set <id> <queryId>
  remy-admin datasources eval delete <setId>
  remy-admin datasources eval run --set <id> [--source <slug>] [--candidate] [--label <text>] [retrieval options] [--wait]
  remy-admin datasources eval runs [--set <id>] [--source <slug>]
  remy-admin datasources eval result <runId> [--queries] [--worst <n>]
  remy-admin datasources eval compare <runA> <runB>

  A query SET is a list of questions with the documents that should come
  back. \`create --size N\` generates them from the corpus: the default
  \`cloze\` style holds one sentence out of a chunk and uses it as the query
  (free and deterministic, but it flatters keyword matching — a real user
  does not type sentences from the document); \`--style question\` has a
  chat model write the question a user would ask (a model call per query,
  cost recorded on the set). Both record the document AND the chunk that
  answers, and both skip sentences that restate the title. Add real user
  questions with \`add\` (--expect takes document ids, filenames or external
  ids, comma-separated; every reference must exist) or \`import\` a JSONL of
  {"query","expect":{"filenames":[...]},"passage"?,"tags"?}.

  A RUN scores a set against one target: the set's own source by default,
  --source another (the parent of a sample, or a sample of the parent —
  expectations resolve by content hash), --candidate the target's candidate
  version. Every query is a real search through the same code apps use, ten
  results deep, with explain on. Retrieval options override the target's
  live config for the run only: --mode, --rerank true|false, --rerank-model
  <id>, --candidates <n>, --hybrid true|false, --top-k <n>. Runs are capped
  at 2,000 queries and cost what 2,000 searches cost.

  \`result\` prints the aggregates — recall@1/5/10, chunk recall, MRR,
  nDCG@10, latency p50/p95, cost per query, how often reranking ran, and
  which branch (dense, lexical, both) found the expected document, per tag
  too — plus \`--worst N\` for the queries that missed and what came back
  instead, or \`--queries\` for every row. \`compare\` puts two runs side by
  side with deltas and, when they share a set, per-query wins and losses.
  The output is JSON; the table is yours to write.

  The workflow: sample the source, create a set on the sample, run it against
  the live version, revectorize with the change you want to test, run again
  with --candidate, compare, promote or drop.
`;
