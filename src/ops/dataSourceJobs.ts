/**
 * Bulk ingestion jobs: load a corpus into a data source from a file-store
 * prefix or a manifest of URLs, with a plan (cost, size, duration) shown
 * before anything is spent.
 *
 * Ops are pure (ctx, params) → typed result. The CLI skin in
 * commands/dataSourceJobs.ts owns flags, progress printing and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import { elapsedSeconds, pollUntil, timedOut } from '../poll.js';
import { uploadDirect } from '../upload.js';
import type {
  DataSourceJob,
  DataSourceJobGetResult,
  DataSourceJobManifestTokenResult,
  DataSourceJobResult,
  DataSourceJobsListResult,
  DataSourceJobSource,
} from '../types/dataSourceJobs.js';

/** @internal Consumed by the CLI skin. */
export const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_MS = 5000;

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/datasources/jobs`;
}

// ─── start ───────────────────────────────────────────────────────────────────

export interface StartParams {
  /** Data source slug. Created on first use, like `add`. */
  slug: string;
  source: DataSourceJobSource;
  /** Run as soon as the plan passes the gates, without a separate approve. */
  approve?: boolean;
  /** Stop when estimated spend reaches this; default 1.5× the projection. */
  budgetDollars?: number;
  /** Batches in flight at once (default 64, max 128). */
  concurrency?: number;
  /** Process only the first N objects — a sample of the corpus. */
  limit?: number;
}

/**
 * Start a job. The platform enumerates the source, reads a sample, and writes
 * a plan; the job then waits in `planned` for `approve` unless `approve` was
 * set. Nothing is embedded until it runs.
 *
 * @throws AdminApiError `data_source_busy` (422) — a move, a candidate
 *   version or another job is in flight; `invalid_source` (400).
 * @example
 * const { job } = await admin.dataSourceJobs.start({
 *   slug: 'archive',
 *   source: { type: 'store', store: 'raw', access: 'private', prefix: '2024/' },
 * });
 */
export function start(ctx: AdminContext, params: StartParams) {
  const { slug, source, approve, budgetDollars, concurrency, limit } = params;
  return call<DataSourceJobResult>(ctx, 'POST', base(ctx.appId), {
    slug,
    source,
    ...(approve ? { approve: true } : {}),
    ...(budgetDollars !== undefined ? { budgetDollars } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
}

// ─── manifests ───────────────────────────────────────────────────────────────

export interface UploadManifestParams {
  slug: string;
  /** JSONL: one `{ url, filename?, externalId?, metadata? }` per line. */
  content: Buffer;
}

/**
 * Upload a manifest for `start` with a `manifest` source. Returns the key to
 * pass as `source.key`.
 */
export async function uploadManifest(
  ctx: AdminContext,
  params: UploadManifestParams,
): Promise<{ key: string }> {
  const token = await call<DataSourceJobManifestTokenResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/manifest-token`,
    { slug: params.slug },
  );
  await uploadDirect(token.upload, params.content, 'manifest.jsonl');
  return { key: token.key };
}

// ─── read ────────────────────────────────────────────────────────────────────

export interface ListParams {
  /** Only this source's jobs; omit for every job on the app. */
  slug?: string;
}

export function list(ctx: AdminContext, params?: ListParams) {
  return call<DataSourceJobsListResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}${qs({ slug: params?.slug })}`,
  );
}

export interface JobIdParams {
  id: string;
}

/** @throws AdminApiError `job_not_found` (404). */
export function get(ctx: AdminContext, params: JobIdParams) {
  return call<DataSourceJobGetResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}`,
  );
}

// ─── controls ────────────────────────────────────────────────────────────────

/**
 * Approve a planned job: the yes to the plan's spend. Refused when the
 * projection does not fit the source's placement or the workspace cannot
 * cover it.
 *
 * @throws AdminApiError `job_not_found` (404), `invalid_transition` (422),
 *   `plan_requires_dedicated` (422), `plan_exceeds_capacity` (422),
 *   `insufficient_credits` (402).
 */
export function approve(
  ctx: AdminContext,
  params: JobIdParams & {
    /** Batches in flight from here on (max 128); the plan was made at the job's current value. */
    concurrency?: number;
  },
) {
  return call<DataSourceJobResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/approve`,
    params.concurrency !== undefined
      ? { concurrency: params.concurrency }
      : undefined,
  );
}

/** Stop dispatching batches; the ones in flight finish. */
export function pause(ctx: AdminContext, params: JobIdParams) {
  return call<DataSourceJobResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/pause`,
  );
}

/** Continue from the checkpoint; failed batches with attempts left are retried. */
export function resume(
  ctx: AdminContext,
  params: JobIdParams & {
    /** Batches in flight from here on (max 128). */
    concurrency?: number;
  },
) {
  return call<DataSourceJobResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/resume`,
    params.concurrency !== undefined
      ? { concurrency: params.concurrency }
      : undefined,
  );
}

/** End the job. Documents already indexed stay. */
export function cancel(ctx: AdminContext, params: JobIdParams) {
  return call<DataSourceJobResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/cancel`,
  );
}

// ─── waits ───────────────────────────────────────────────────────────────────

export interface WaitParams {
  id: string;
  /** Default one hour. */
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export type WaitResult =
  | { status: 'done'; job: DataSourceJob }
  /** The plan is ready but the job will not run on its own: a gate refused, or it waits for approval. */
  | { status: 'planned'; job: DataSourceJob; error: string }
  | { status: 'failed'; job: DataSourceJob; error: string }
  | { status: 'timeout'; job: DataSourceJob; error: string };

/**
 * Poll until the job leaves `planning`: the plan is ready (`done`), or a gate
 * refused it (`planned` with the job's error), or it could not be planned.
 */
export function waitForPlan(ctx: AdminContext, params: WaitParams) {
  return settle(ctx, params, (job) => job.state !== 'planning');
}

/**
 * Poll until the job reaches a terminal state, pauses, or settles in `planned`
 * with nothing about to move it: a gate refused an auto-approved plan, or the
 * plan waits for an approval nobody asked this wait to give. A pause is
 * reported as `failed` with the pause reason, since nothing more will happen
 * without the owner.
 */
export function waitForJob(ctx: AdminContext, params: WaitParams) {
  return settle(
    ctx,
    params,
    (job) =>
      !['planning', 'planned', 'running'].includes(job.state) ||
      (job.state === 'planned' && (job.error !== null || !job.autoApprove)),
  );
}

async function settle(
  ctx: AdminContext,
  params: WaitParams,
  isSettled: (job: DataSourceJob) => boolean,
): Promise<WaitResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const outcome = await pollUntil(
    async () => (await get(ctx, { id: params.id })).job,
    isSettled,
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: describeProgress,
      onProgress: params.onProgress,
    },
  );
  const job = outcome.value;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      job,
      error: timedOut(timeoutMs, `; job is still ${job.state}`),
    };
  }
  if (job.state === 'failed' || job.state === 'cancelled') {
    return {
      status: 'failed',
      job,
      error: job.error ?? `The job was ${job.state}.`,
    };
  }
  if (job.state === 'paused') {
    return {
      status: 'failed',
      job,
      error:
        job.error ??
        `The job paused (${job.pauseReason ?? 'user'}). Resume it to continue.`,
    };
  }
  if (job.state === 'planned' && (job.error !== null || job.autoApprove)) {
    return {
      status: 'planned',
      job,
      error:
        job.error ??
        'The plan is ready but the job did not start. Approve it once the cause is fixed.',
    };
  }
  return { status: 'done', job };
}

/** One line of progress in the job's own terms. */
export function describeProgress(job: DataSourceJob, start: number): string {
  const elapsed = `(${elapsedSeconds(start)}s)`;
  if (job.state === 'planning') {
    return job.enumerationDone
      ? `planning… reading a sample of ${job.counts.objectsSeen.toLocaleString()} objects ${elapsed}`
      : `planning… ${job.counts.objectsSeen.toLocaleString()} objects counted ${elapsed}`;
  }
  const total = job.plan?.projected.documents ?? job.counts.objectsSeen;
  const processed =
    job.counts.documentsDone +
    job.counts.documentsSkipped +
    job.counts.documentsFailed;
  const spend = `$${job.estimatedDollars.toFixed(2)}${
    job.budgetDollars !== null ? ` of $${job.budgetDollars.toFixed(2)}` : ''
  }`;
  return `${job.state}… ${processed.toLocaleString()}/${total.toLocaleString()} documents · ${spend} ${elapsed}`;
}
