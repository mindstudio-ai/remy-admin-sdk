/**
 * Cron (scheduled job) operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/cron.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type { CronOverviewResult, CronRunResult } from '../types/cron.js';

export interface CronListParams {
  /** Recent runs to include per job (default 15, clamped 1–120). */
  runs?: number;
}

/**
 * Every scheduled job with its status and recent runs.
 *
 * Job status is `active | paused | blocked` (`statusReason` says why); a run's
 * id doubles as its request-log id, so a failing job's story continues with
 * `requests.get(runId)`.
 *
 * @example
 * const { jobs } = await admin.cron.list({ runs: 50 });
 * const blocked = jobs.filter((j) => j.status === 'blocked');
 */
export function list(ctx: AdminContext, params: CronListParams = {}) {
  return call<CronOverviewResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/cron/overview${qs(params)}`,
  );
}

/**
 * Trigger a job now (does not affect its schedule).
 *
 * Returns 202 immediately — the run continues in the background; check the
 * outcome via `requests.get(requestId)`.
 *
 * @param route The job's method id, as shown by `list`.
 * @throws AdminApiError `cron_job_not_found` (404) — the route isn't a
 *   scheduled method; `run_already_triggered` (429) — a manual run is in
 *   flight, or within the 30s debounce; `creator_unavailable` (400) — the
 *   creator account is gone.
 * @example
 * const { requestId } = await admin.cron.run('dailyDigest');
 */
export function run(ctx: AdminContext, route: string) {
  return call<CronRunResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/cron/${seg(route)}/run`,
  );
}
