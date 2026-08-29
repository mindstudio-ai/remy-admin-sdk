/**
 * Response shapes for the cron command group — transcribed from youai-api.
 *
 * Sources:
 *   src/http/routes/V2Apps/manage/cron.ts
 *   src/common/Db/v2Apps/AppCronJobsDao.ts (AppCronJobSummary ~line 61, decorateJob ~line 383)
 *   src/common/Db/v2Apps/AppCronRunsDao.ts (CronRunSummary ~line 50)
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Lifecycle state of a single cron run row. */
export type AppCronRunState =
  'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';

/** Explicit status machine for a scheduled job. */
export type AppCronJobStatus = 'active' | 'paused' | 'blocked';

/** Why a job is paused or blocked. */
export type AppCronJobStatusReason =
  | 'auto_failures'
  | 'manual'
  | 'creator_unavailable'
  | 'app_deleted'
  | 'invalid_expression';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * One lane entry per cron run (AppCronRunsDao.CronRunSummary).
 * Structurally compatible with the retired request-log MethodRunSummary so the
 * frontend lane component renders both endpoints without branching.
 */
export interface CronRunSummary {
  id: string;
  startedAt: string;
  durationMs: number | null;
  /** null while the run is still in flight. */
  success: boolean | null;
  manual: boolean;
  /** Ledger state — lets the UI distinguish queued from running. */
  state: AppCronRunState;
}

/**
 * Per-app cron job summary (AppCronJobsDao.AppCronJobSummary) decorated with
 * the three derived fields `decorateJob` attaches before the response is sent.
 *
 * `executionCount` is LIFETIME — survives deploys.
 * `blocked` is non-null when the job is blocked; value is the reason string.
 * A run's `id` is also its request-log id; follow a failure with
 * `requests get <runId>`.
 */
export interface CronJobDecorated {
  id: string;
  route: string;
  schedule: string;
  scheduleDescription: string;
  timezone: string;
  description: string;
  nextRunAt: string | null;
  executionCount: number;
  paused: boolean;
  consecutiveFailures: number;
  /** Non-null when the job is blocked; value is the status reason string. */
  blocked: string | null;
  status: AppCronJobStatus;
  statusReason: AppCronJobStatusReason | null;
  /** Derived server-side (tz-aware cron parse). Null when expression is invalid. */
  periodMs: number | null;
  /** ISO timestamp of the most recent failure; may predate the run window. */
  lastFailureAt: string | null;
  runs: CronRunSummary[];
}

// ---------------------------------------------------------------------------
// Result types — one per endpoint/command
// ---------------------------------------------------------------------------

/** cron list → GET /cron/overview */
export interface CronOverviewResult {
  jobs: CronJobDecorated[];
}

/** cron run → POST /cron/:route/run (202) */
export interface CronRunResult {
  requestId: string;
  methodId: string;
}
