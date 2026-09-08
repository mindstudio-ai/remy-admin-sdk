/**
 * Warming an index, sampling a source, and retrieval evals: query sets, runs,
 * comparisons. Ops are pure (ctx, params) → typed result; the CLI skin in
 * commands/dataSourceEvals.ts owns flags, progress printing and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import { elapsedSeconds, pollUntil, timedOut } from '../poll.js';
import { list as listSources } from './dataSources.js';
import type { DataSourcesListEntry } from '../types/dataSources.js';
import type {
  DataSourcesHydrateResult,
  DataSourcesSampleResult,
  EvalCompareResult,
  EvalQueriesAddResult,
  EvalQueriesListResult,
  EvalQueryStyle,
  EvalRetrieval,
  EvalRun,
  EvalRunResult,
  EvalRunsListResult,
  EvalSet,
  EvalSetGetResult,
  EvalSetResult,
  EvalSetsListResult,
} from '../types/dataSourceEvals.js';

/** @internal Consumed by the CLI skin. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_MS = 4000;

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/datasources`;
}

// ─── hydrate ─────────────────────────────────────────────────────────────────

/**
 * Warm a source's index if it is cold. A search on a large cold index answers
 * `index_warming` until the reload lands; call this before a demo, or after an
 * eviction you know about. Answers `resident: true` when nothing was needed.
 */
export function hydrate(ctx: AdminContext, params: { slug: string }) {
  return call<DataSourcesHydrateResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/hydrate`,
    { slug: params.slug },
  );
}

/**
 * Recreate a dedicated source's collection with the platform's current shape
 * and refill it from the stored vectors. Nothing is re-embedded. Dedicated
 * capacity only; refused while a job, move, hydration or candidate version is
 * in flight, and with `collection_shared` when another source shares the
 * collection on that capacity. Same response as `hydrate`: follow it with
 * `waitForHydration`.
 *
 * @throws AdminApiError `reindex_requires_dedicated` (422), `data_source_busy`
 *   (422), `collection_shared` (422).
 */
export function reindex(ctx: AdminContext, params: { slug: string }) {
  return call<DataSourcesHydrateResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/reindex`,
    { slug: params.slug },
  );
}

export interface WaitForHydrationParams {
  slug: string;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export type WaitForHydrationResult =
  | { status: 'done'; source: DataSourcesListEntry }
  | { status: 'failed'; source: DataSourcesListEntry; error: string }
  | { status: 'timeout'; source: DataSourcesListEntry; error: string };

/** Poll the source list until its `hydration` clears, fails, or the timeout elapses. */
export async function waitForHydration(
  ctx: AdminContext,
  params: WaitForHydrationParams,
): Promise<WaitForHydrationResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const outcome = await pollUntil(
    async () => {
      const { dataSources } = await listSources(ctx);
      const source = dataSources.find((s) => s.slug === params.slug);
      if (!source) {
        throw new Error(`Data source "${params.slug}" not found.`);
      }
      return source;
    },
    (source) => !source.hydration || source.hydration.error !== null,
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (source, start) =>
        `loading… ${source.hydration!.copied}/${source.hydration!.total} documents (${elapsedSeconds(start)}s)`,
      onProgress: params.onProgress,
    },
  );
  const source = outcome.value;
  const hydration = source.hydration;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      source,
      error: timedOut(
        timeoutMs,
        `with ${hydration!.copied}/${hydration!.total} documents loaded`,
      ),
    };
  }
  if (hydration?.error) {
    return { status: 'failed', source, error: hydration.error };
  }
  return { status: 'done', source };
}

// ─── sample ──────────────────────────────────────────────────────────────────

export interface SampleParams {
  /** The source to draw from. */
  slug: string;
  /** Documents to draw (at most 2,000). */
  size: number;
  /** Slug for the sample; default `<slug>-sample`. */
  as?: string;
  /** Scope the draw: metadata equality, or the full document selector. */
  filter?: Record<string, unknown>;
  /** Metadata key to stratify on, proportional per value. */
  stratify?: string;
  placement?: { resourceId: string } | 'shared';
}

/**
 * Draw a sample of a source into a new source with the same pinned config.
 * The copy is a job (auto-approved; extraction is reused by content hash, so
 * the plan is chunk + embed only). Documents keep their content hashes, which
 * is what lets an eval set built on the sample score the parent too.
 *
 * @throws AdminApiError `invalid_size` (400), `slug_in_use` (422),
 *   `data_source_limit` (422), `data_source_busy` (422).
 */
export function sample(ctx: AdminContext, params: SampleParams) {
  const { slug, size, as, filter, stratify, placement } = params;
  return call<DataSourcesSampleResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/sample`,
    {
      slug,
      size,
      ...(as ? { as } : {}),
      ...(filter ? { filter } : {}),
      ...(stratify ? { stratify } : {}),
      ...(placement !== undefined ? { placement } : {}),
    },
  );
}

// ─── query sets ──────────────────────────────────────────────────────────────

export interface CreateSetParams {
  slug: string;
  /** Lowercase [a-z0-9_-], unique per source. */
  name: string;
  description?: string;
  /** Queries to generate from the corpus; 0 (default) makes an empty set to add to. */
  size?: number;
  /** `cloze` (default, free) or `question` (a chat model writes them). */
  style?: EvalQueryStyle;
  /** Chat model for `question`; default the source's contextual model or the platform's. */
  modelId?: string;
  tags?: string[];
  /** Makes generation reproducible; default the current time. */
  seed?: number;
}

/**
 * Create a query set, generating queries from the corpus when `size` is set.
 * Generation runs in the background; the set is `generating` until it is
 * `ready` (see `waitForSet`).
 *
 * @throws AdminApiError `eval_set_exists` (422), `invalid_name` (400).
 */
export function createSet(ctx: AdminContext, params: CreateSetParams) {
  const { slug, name, description, size, style, modelId, tags, seed } = params;
  return call<EvalSetResult>(ctx, 'POST', `${base(ctx.appId)}/eval/sets`, {
    slug,
    name,
    ...(description ? { description } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(style ? { style } : {}),
    ...(modelId ? { modelId } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });
}

export function listSets(ctx: AdminContext, params?: { slug?: string }) {
  return call<EvalSetsListResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/sets${qs({ slug: params?.slug })}`,
  );
}

export function getSet(
  ctx: AdminContext,
  params: { id: string; queries?: boolean },
) {
  return call<EvalSetGetResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/sets/${encodeURIComponent(params.id)}${qs({
      queries: params.queries ? 'true' : undefined,
    })}`,
  );
}

export function deleteSet(ctx: AdminContext, params: { id: string }) {
  return call<{ deleted: true; set: EvalSet }>(
    ctx,
    'POST',
    `${base(ctx.appId)}/eval/sets/${encodeURIComponent(params.id)}/delete`,
  );
}

export interface QueryInput {
  query: string;
  /** Which documents should come back; each reference must exist on the set's source. */
  expect: {
    documentIds?: string[];
    filenames?: string[];
    externalIds?: string[];
    contentHashes?: string[];
  };
  passage?: string;
  tags?: string[];
}

/**
 * Add hand-written queries (≤ 500 per call). Every reference is resolved
 * before anything is written; an unknown filename refuses the whole call by
 * name (`expected_document_not_found`).
 */
export function addQueries(
  ctx: AdminContext,
  params: { id: string; queries: QueryInput[] },
) {
  return call<EvalQueriesAddResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/eval/sets/${encodeURIComponent(params.id)}/queries`,
    { queries: params.queries },
  );
}

export function listQueries(ctx: AdminContext, params: { id: string }) {
  return call<EvalQueriesListResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/sets/${encodeURIComponent(params.id)}/queries`,
  );
}

export function deleteQuery(
  ctx: AdminContext,
  params: { id: string; queryId: string },
) {
  return call<{ deleted: string; queryCount: number }>(
    ctx,
    'POST',
    `${base(ctx.appId)}/eval/sets/${encodeURIComponent(params.id)}/queries/delete`,
    { queryId: params.queryId },
  );
}

// ─── runs ────────────────────────────────────────────────────────────────────

export interface RunParams {
  setId: string;
  /** Target source; default the set's own. Expectations resolve by content hash. */
  slug?: string;
  /** Evaluate the target's candidate version instead of the active one. */
  candidate?: boolean;
  label?: string;
  retrieval?: EvalRetrieval;
}

/**
 * Score a set against a target. Runs in the background; block with
 * `waitForRun`. Each query is a real search (embedding + rerank spend).
 *
 * @throws AdminApiError `eval_set_not_ready` (422), `eval_set_empty` (422),
 *   `no_candidate_pipeline` (404), `invalid_retrieval` (400).
 */
export function run(ctx: AdminContext, params: RunParams) {
  const { setId, slug, candidate, label, retrieval } = params;
  return call<EvalRunResult>(ctx, 'POST', `${base(ctx.appId)}/eval/runs`, {
    setId,
    ...(slug ? { slug } : {}),
    ...(candidate ? { candidate: true } : {}),
    ...(label ? { label } : {}),
    ...(retrieval && Object.keys(retrieval).length ? { retrieval } : {}),
  });
}

export function listRuns(
  ctx: AdminContext,
  params?: { setId?: string; slug?: string },
) {
  return call<EvalRunsListResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/runs${qs({ setId: params?.setId, slug: params?.slug })}`,
  );
}

export function getRun(
  ctx: AdminContext,
  params: { id: string; queries?: boolean; worst?: number },
) {
  return call<EvalRunResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/runs/${encodeURIComponent(params.id)}${qs({
      queries: params.queries ? 'true' : undefined,
      worst: params.worst,
    })}`,
  );
}

/** Two runs side by side: aggregate deltas, and per-query wins/losses when they share a set. */
export function compare(ctx: AdminContext, params: { a: string; b: string }) {
  return call<EvalCompareResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/eval/runs/compare${qs({ a: params.a, b: params.b })}`,
  );
}

// ─── waits ───────────────────────────────────────────────────────────────────

export interface WaitParams {
  id: string;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export type WaitForRunResult =
  | { status: 'done'; run: EvalRun }
  | { status: 'failed'; run: EvalRun; error: string }
  | { status: 'timeout'; run: EvalRun; error: string };

export async function waitForRun(
  ctx: AdminContext,
  params: WaitParams,
): Promise<WaitForRunResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const outcome = await pollUntil(
    async () => (await getRun(ctx, { id: params.id })).run,
    (run) => run.state === 'done' || run.state === 'failed',
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (run, start) =>
        `${run.state}… ${run.completed}/${run.total} queries (${elapsedSeconds(start)}s)`,
      onProgress: params.onProgress,
    },
  );
  const run = outcome.value;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      run,
      error: timedOut(
        timeoutMs,
        `; run is ${run.state} (${run.completed}/${run.total})`,
      ),
    };
  }
  if (run.state === 'failed') {
    return { status: 'failed', run, error: run.error ?? 'The run failed.' };
  }
  return { status: 'done', run };
}

export type WaitForSetResult =
  | { status: 'done'; set: EvalSet }
  | { status: 'failed'; set: EvalSet; error: string }
  | { status: 'timeout'; set: EvalSet; error: string };

/** Poll until generation lands (`ready`) or fails; a set waits `queued` for a worker first. */
export async function waitForSet(
  ctx: AdminContext,
  params: WaitParams,
): Promise<WaitForSetResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const outcome = await pollUntil(
    async () => (await getSet(ctx, { id: params.id })).set,
    (set) => set.state === 'ready' || set.state === 'failed',
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (set, start) => `${set.state}… (${elapsedSeconds(start)}s)`,
      onProgress: params.onProgress,
    },
  );
  const set = outcome.value;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      set,
      error: timedOut(timeoutMs, `; set is still ${set.state}`),
    };
  }
  if (set.state === 'failed') {
    return { status: 'failed', set, error: set.error ?? 'Generation failed.' };
  }
  return { status: 'done', set };
}
