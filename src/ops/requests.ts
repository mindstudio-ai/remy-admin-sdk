/**
 * Request log + method metrics operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/requests.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  RequestsListResult,
  RequestsGetResult,
  RequestsStatsSummaryResult,
  RequestsStatsMethodResult,
} from '../types/requests.js';

export interface RequestsListParams {
  /** Filter to a single method id (e.g. `mth_abc123`). */
  methodId?: string;
  /** `'success'` or `'error'` — omit to return all statuses. */
  status?: string;
  /** Maximum rows to return (default 50). */
  limit?: number;
  /** Row offset for pagination (default 0). */
  offset?: number;
  /** Keyset cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

export interface MetricsWindowParams {
  /** Window start as an ISO 8601 date string (inclusive). */
  start?: string;
  /** Window end as an ISO 8601 date string (inclusive). */
  end?: string;
}

/**
 * Recent request log entries, optionally filtered by method or status.
 *
 * Results are cursor-paginated — check `nextCursor` to page forward. Default
 * `limit` is 50 and `offset` is 0. A run's `id` is also its request-log id,
 * so `requests.get(id)` drills into the full payload for any interface
 * (cron, api, agent, …).
 *
 * @example
 * const { requests } = await admin.requests.list({ status: 'error', limit: 10 });
 */
export function list(ctx: AdminContext, params: RequestsListParams = {}) {
  return call<RequestsListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/requests${qs(params)}`,
  );
}

/**
 * Full request log entry — input, output, stdout, error, and interface context.
 *
 * @param requestId The request id (e.g. from `list`, or the `requestId`
 *   returned by `cron.run`).
 * @throws AdminApiError `not_found` (404) — the request id does not exist or
 *   belongs to a different app.
 * @example
 * const entry = await admin.requests.get('req_abc123');
 */
export function get(ctx: AdminContext, requestId: string) {
  return call<RequestsGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/requests/${seg(requestId)}`,
  );
}

/**
 * Aggregated metrics for the whole app over a time window.
 *
 * Returns per-bucket totals, per-method breakdowns with sparklines,
 * per-error-type counts, and interface distribution. When `start`/`end` are
 * omitted the server applies its own default window.
 *
 * @example
 * const { totals, byMethod } = await admin.requests.statsSummary();
 */
export function statsSummary(
  ctx: AdminContext,
  params: MetricsWindowParams = {},
) {
  return call<RequestsStatsSummaryResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/metrics/summary${qs(params)}`,
  );
}

/**
 * Per-method time-series metrics over a time window.
 *
 * Returns per-bucket counts (including `successCount`, which is absent from
 * the app-summary buckets), overall totals, and an error-type breakdown.
 * When `start`/`end` are omitted the server applies its own default window.
 *
 * @param methodId The method id to scope the query (e.g. `mth_abc123`).
 * @example
 * const { buckets, totals } = await admin.requests.statsForMethod('mth_abc123');
 */
export function statsForMethod(
  ctx: AdminContext,
  methodId: string,
  params: MetricsWindowParams = {},
) {
  return call<RequestsStatsMethodResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/metrics/methods/${seg(methodId)}${qs(params)}`,
  );
}
