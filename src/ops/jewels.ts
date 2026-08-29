/**
 * Jewels operations: shadowing overview, pair ledger, approval queue, training.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/jewels.ts and the importable client both call these.
 *
 * Long-running ops (resolve --approve, dryrun, train, grade) hold the request
 * for a full agent/model run; they pass their own timeout bound to `call`.
 * The constant is exported so the CLI skin can pass the same value to
 * cliStream.rawToStdout for the `jewels export --file` passthrough.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';

import type {
  JewelsDryrunResult,
  JewelsExportResult,
  JewelsGradeResult,
  JewelsOverviewResult,
  JewelsPairResult,
  JewelsPairsResult,
  JewelsQueueResult,
  JewelsResolveResult,
  JewelsRunResult,
  JewelsRunsResult,
  JewelsTimeseriesResult,
  JewelsTrainResult,
} from '../types/jewels.js';

/**
 * Jewel runs are full agent loops: resolve --approve applies the method as
 * the reviewer, and dryrun executes the live jewel end to end — both can
 * legitimately take minutes, so they get their own request bound.
 * @internal Consumed by the CLI skin; not part of the documented surface.
 */
export const JEWEL_RUN_TIMEOUT_MS = 600_000;

export interface WindowParams {
  /** ISO date string for the start of the query window (default: 30 days before `end`). */
  start?: string;
  /** ISO date string for the end of the query window (default: now). */
  end?: string;
}

export interface JewelsPairsParams extends WindowParams {
  /** Filter to a specific method id. */
  methodId?: string;
  /** Filter by verdict: `agree`, `disagree`, `skip`, or `expired`. */
  verdict?: string;
  /** Filter by shadow mode: `shadow`, `arrival`, `auto`, or `approve`. */
  mode?: string;
  /** Page size (default 50). */
  limit?: number;
  /** Keyset cursor from a previous response's `nextCursor`. */
  cursor?: string;
}

export interface JewelsQueueParams {
  /** Filter to a specific method id. */
  methodId?: string;
  /** Max items to return (default 50). */
  limit?: number;
}

export interface JewelsTimeseriesParams extends WindowParams {
  /** Filter to a specific method id. */
  methodId?: string;
  /** Number of time buckets (default 24). */
  buckets?: number;
}

export interface JewelsResolveParams {
  /** The queue item's id (from `queue` results). */
  itemId: string;
  /**
   * `approve` runs the method for real as the calling user (the reviewer),
   * grades the proposed-vs-final pair, and closes the item.  `dismiss` closes
   * the item without acting — no method run, no pair recorded.
   */
  action: 'approve' | 'dismiss';
  /**
   * Override the proposed input before applying (approve only).  When set the
   * resolution is recorded as `edited`; omit to apply the proposal as-is.
   */
  input?: Record<string, unknown>;
}

export interface JewelsDryrunParams {
  /** The method id whose jewel should run against `subject`. */
  methodId: string;
  /** The triggering subject object to pass to the jewel. */
  subject: Record<string, unknown>;
}

export interface JewelsExportParams extends WindowParams {
  /** The method id to export pairs for. */
  methodId: string;
}

export interface JewelsTrainParams {
  /** The method id to train a fine-tuning run for. */
  methodId: string;
}

export interface JewelsRunsParams {
  /** Filter to a specific method id. */
  methodId?: string;
  /** Max runs to return (default 20). */
  limit?: number;
}

/**
 * Per-method shadowing overview: autonomy, sample rate, pair counts by verdict,
 * agreement rate, human-invocation coverage, and queue depth.
 *
 * Time window defaults to the last 30 days when `start`/`end` are omitted.
 * Training summary (active run, last run, latest model) is always all-time
 * regardless of the window — it reflects current model state, not the pair
 * stats window.
 *
 * @example
 * const { methods, totals } = await admin.jewels.overview();
 * const shadowed = methods.filter((m) => m.hasJewel);
 */
export function overview(ctx: AdminContext, params: WindowParams = {}) {
  return call<JewelsOverviewResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/overview${qs(params)}`,
  );
}

/**
 * Verdict counts (agree / disagree / skip / expired) over time, bucketed.
 *
 * One bucket array per method; use `methodId` to narrow to a single series.
 * Time window defaults to the last 30 days.
 *
 * @example
 * const { methods } = await admin.jewels.timeseries({ methodId: 'triage-issue', buckets: 48 });
 */
export function timeseries(
  ctx: AdminContext,
  params: JewelsTimeseriesParams = {},
) {
  return call<JewelsTimeseriesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/timeseries${qs(params)}`,
  );
}

/**
 * Paginated list of slim pair rows (excludes the full JSONB pair payload).
 *
 * Use `pair(pairId)` to fetch the full record with hydrated traces.
 * Time window defaults to the last 30 days.
 *
 * @example
 * const { pairs, nextCursor } = await admin.jewels.pairs({ verdict: 'disagree' });
 */
export function pairs(ctx: AdminContext, params: JewelsPairsParams = {}) {
  return call<JewelsPairsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/pairs${qs(params)}`,
  );
}

/**
 * Full pair record: proposed vs actual output, reasoning, grade notes, and
 * hydrated model transcripts (propose + grade phases) when the jewel attached
 * traces.  Objects that could not be fetched degrade to `{ id, phase, missing: true }`
 * rather than a 500.
 *
 * @param pairId The pair id (from `pairs` results or the overview).
 * @throws AdminApiError `pair_not_found` (404) — no pair with this id in this app.
 * @example
 * const { pair, traces } = await admin.jewels.pair('6f1e...');
 */
export function pair(ctx: AdminContext, pairId: string) {
  return call<JewelsPairResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/pairs/${seg(pairId)}`,
  );
}

/**
 * Pending approve-mode proposals awaiting review.
 *
 * Only items for methods with `autonomy: 'approve'` appear here.  Use
 * `resolve` to approve or dismiss an item.
 *
 * @example
 * const { items } = await admin.jewels.queue({ methodId: 'triage-issue' });
 */
export function queue(ctx: AdminContext, params: JewelsQueueParams = {}) {
  return call<JewelsQueueResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/queue${qs(params)}`,
  );
}

/**
 * Approve or dismiss one approval-queue item.
 *
 * **Approve** applies the method as the calling user (the reviewer): the
 * proposal's input runs for real, the platform grades proposed-vs-final, and
 * the item closes.  Pass `input` to apply an edited version (resolution
 * recorded as `edited`).  **Dismiss** closes the item without acting — no
 * method run, no pair recorded.
 *
 * The request holds for a full jewel/method run — allow minutes (up to
 * `JEWEL_RUN_TIMEOUT_MS`).
 *
 * @example
 * const { resolution, output } = await admin.jewels.resolve({ itemId: '6f1e...', action: 'approve' });
 */
export function resolve(ctx: AdminContext, params: JewelsResolveParams) {
  const body: Record<string, unknown> = {
    itemId: params.itemId,
    action: params.action,
  };
  if (params.input !== undefined) {
    body.input = params.input;
  }
  return call<JewelsResolveResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/jewels/queue/resolve`,
    body,
    JEWEL_RUN_TIMEOUT_MS,
  );
}

/**
 * Run the live jewel against a subject without recording or committing
 * anything.
 *
 * Executes inside a disposable database mirror — guaranteed side-effect-free
 * on the app database.  The prod twin of the dev `testJewel` tool (which runs
 * draft code against the dev DB); this one answers for the deployed release
 * against the real world.  Allow minutes for the full jewel run.
 *
 * @throws AdminApiError `invalid_subject` (400) — `subject` is not an object;
 *   `invalid_app_method` (400) — unknown method id; `no_jewel` (400) — the
 *   method has no compiled jewel in the live release.
 * @example
 * const { record } = await admin.jewels.dryrun({ methodId: 'triage-issue', subject: { issueId: 'abc' } });
 */
export function dryrun(ctx: AdminContext, params: JewelsDryrunParams) {
  return call<JewelsDryrunResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/jewels/${seg(params.methodId)}/dryrun`,
    { subject: params.subject },
    JEWEL_RUN_TIMEOUT_MS,
  );
}

/**
 * Dataset report (no `--file`): per-file row counts, every exclusion bucket
 * named (skip, expired, ungraded, auto, traceless, traceMissing,
 * preferenceUnrenderable), and trace coverage.
 *
 * The streaming JSONL variant (`--file`) is handled entirely by the CLI skin
 * via `cliStream.rawToStdout` — it is not an op.
 *
 * @throws AdminApiError `missing_method_id` (400) — `methodId` is required;
 *   `invalid_file` (400) — `file` is not one of the allowed dataset file types.
 * @example
 * const { summary } = await admin.jewels.exportSummary({ methodId: 'triage-issue' });
 */
export function exportSummary(ctx: AdminContext, params: JewelsExportParams) {
  return call<JewelsExportResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/export${qs(params)}`,
    undefined,
    JEWEL_RUN_TIMEOUT_MS,
  );
}

/**
 * Kick off a LoRA fine-tuning run on the method's graded pairs.
 *
 * Returns **immediately** with a run id and dataset report (per-file row
 * counts, exclusion buckets); the GPU trainer runs asynchronously.  Poll
 * with `getRun(run.id)` for live progress — the run's `log` carries a
 * narrated status timeline and loss-curve points.  One run per method at
 * a time.
 *
 * The tuning dial comes from the method's manifest in the live release.
 * The report's agreement is scored against the held-out ledger split —
 * real decisions the model never saw.
 *
 * @throws AdminApiError `missing_method_id` (400) — `methodId` is required;
 *   `invalid_app_method` (400) — unknown method id; `no_jewel` (400) — the
 *   method has no compiled jewel in the live release.
 * @example
 * const { run, summary } = await admin.jewels.train({ methodId: 'triage-issue' });
 * // poll for completion:
 * const { run: status } = await admin.jewels.getRun(run.id);
 */
export function train(ctx: AdminContext, params: JewelsTrainParams) {
  return call<JewelsTrainResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/jewels/train`,
    { methodId: params.methodId },
    JEWEL_RUN_TIMEOUT_MS,
  );
}

/**
 * List training runs newest-first.
 *
 * The `log` field is serialized as `[]` in list responses; fetch a single
 * run with `getRun` to read the full event log.
 *
 * @example
 * const { runs } = await admin.jewels.runs({ methodId: 'triage-issue' });
 */
export function runs(ctx: AdminContext, params: JewelsRunsParams = {}) {
  return call<JewelsRunsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/training-runs${qs(params)}`,
  );
}

/**
 * Get one training run with its full event log and report.
 *
 * The run's `log` is an append-only array of `status` (narration) and `loss`
 * (training curve) entries — the primary polling target for `train --wait`.
 * Status `complete` or `failed` is the terminal signal.
 *
 * @param runId The run id returned by `train` or `runs`.
 * @throws AdminApiError `run_not_found` (404) — no run with this id in this app.
 * @example
 * const { run } = await admin.jewels.getRun(runId);
 * if (run.status === 'complete') console.log(run.report?.grading);
 */
export function getRun(ctx: AdminContext, runId: string) {
  return call<JewelsRunResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/jewels/training-runs/${seg(runId)}`,
  );
}

/**
 * Re-grade a completed run's held-out predictions with the jewel's own grade
 * function (the same grader as the pairs dashboard).
 *
 * Writes `report.grading`.  Runs automatically on completion — use this as
 * the manual retry or backfill for runs that predate the grading feature or
 * whose fire-and-forget trigger was lost.  Idempotent.
 *
 * @param runId The run id to grade.
 * @throws AdminApiError `run_not_found` (404) — no run with this id in this app.
 * @example
 * const { grading } = await admin.jewels.grade(runId);
 * console.log(`agreement: ${grading.agreement}`);
 */
export function grade(ctx: AdminContext, runId: string) {
  return call<JewelsGradeResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/jewels/training-runs/${seg(runId)}/grade`,
    undefined,
    JEWEL_RUN_TIMEOUT_MS,
  );
}
