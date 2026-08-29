/**
 * Crash (frontend-error) operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/crashes.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  CrashesGetResult,
  CrashesListResult,
  CrashesOccurrencesResult,
  CrashesStatsResult,
} from '../types/crashes.js';

export interface CrashesListParams {
  /** Filter to a specific release id. */
  releaseId?: string;
  /** Sort order: `'recent'` (default) or `'frequent'`. */
  sort?: string;
  /** Maximum crash groups to return (default 50). */
  limit?: number;
  /** Window start as an ISO 8601 date string. Defaults to 7 days ago. */
  start?: string;
  /** Window end as an ISO 8601 date string. Defaults to now. */
  end?: string;
}

export interface CrashesOccurrencesParams {
  /** Filter to a specific release id. */
  releaseId?: string;
  /** Pagination cursor from a prior response's `nextCursor`. */
  cursor?: string;
  /** Maximum events to return (default 50). */
  limit?: number;
  /** Window start as an ISO 8601 date string. */
  start?: string;
  /** Window end as an ISO 8601 date string. */
  end?: string;
}

export interface CrashesStatsParams {
  /** Filter to a specific release id. */
  releaseId?: string;
  /** Window start as an ISO 8601 date string. */
  start?: string;
  /** Window end as an ISO 8601 date string. */
  end?: string;
  /** Number of time buckets to return (default 24). */
  buckets?: number;
}

/**
 * Crash groups (one row per fingerprint) with occurrence counts and affected users.
 *
 * Groups are Sentry-style fingerprints. Each row carries an `exampleEventId`
 * — pass it to `crashes.get()` for a quick drill-in without iterating
 * occurrences. Time window defaults to the last 7 days when `start`/`end`
 * are omitted.
 *
 * @example
 * const { errors } = await admin.crashes.list({ sort: 'frequent', limit: 10 });
 */
export function list(ctx: AdminContext, params: CrashesListParams = {}) {
  return call<CrashesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/frontend-errors${qs(params)}`,
  );
}

/**
 * Individual crash events for one fingerprint, cursor-paginated.
 *
 * Pass `nextCursor` from a prior response as `cursor` to fetch the next page.
 *
 * @param fingerprint The fingerprint string from a `list` row.
 * @example
 * const { errors, nextCursor } = await admin.crashes.occurrences('abc123fingerprint', { limit: 25 });
 */
export function occurrences(
  ctx: AdminContext,
  fingerprint: string,
  params: CrashesOccurrencesParams = {},
) {
  return call<CrashesOccurrencesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/frontend-errors/${seg(fingerprint)}/events${qs(params)}`,
  );
}

/**
 * Full crash event detail — stack trace, source location, breadcrumbs, and browser context.
 *
 * @param eventId The event id (e.g. `exampleEventId` from a `list` row, or
 *   any id from an `occurrences` response).
 * @throws AdminApiError `not_found` (404) — the event id does not exist or
 *   belongs to a different app.
 * @example
 * const event = await admin.crashes.get('evt_xyz789');
 */
export function get(ctx: AdminContext, eventId: string) {
  return call<CrashesGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/frontend-errors/events/${seg(eventId)}`,
  );
}

/**
 * Bucketed time series of total crash occurrence volume for the app.
 *
 * Returns per-bucket counts and overall totals for the window. When
 * `start`/`end` are omitted the server applies its own default window.
 *
 * @example
 * const { buckets, totals } = await admin.crashes.stats({ buckets: 24 });
 */
export function stats(ctx: AdminContext, params: CrashesStatsParams = {}) {
  return call<CrashesStatsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/frontend-errors/metrics/summary${qs(params)}`,
  );
}
