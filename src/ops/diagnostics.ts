/**
 * Diagnostics operations: live-release id resolution (delegates to
 * ops/releases.ts to avoid duplicating the dashboard call), release diagnostics
 * fetch, and raw Lighthouse report download.
 *
 * Ops are pure: (ctx, params) → typed result. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call, fetchWithTimeout, REPORT_TIMEOUT_MS, seg } from '../http.js';
import { dashboardLive } from './releases.js';
import type { DiagnosticsReleaseResult } from '../types/diagnostics.js';

/**
 * Resolve the id of the currently-live release, or null if the app has not
 * been published. Delegates to the releases dashboardLive op to avoid
 * duplicating the dashboard endpoint call.
 *
 * @example
 * const releaseId = await admin.diagnostics.getLiveReleaseId();
 */
export async function getLiveReleaseId(
  ctx: AdminContext,
): Promise<string | null> {
  const live = await dashboardLive(ctx);
  return live?.id ?? null;
}

/**
 * Fetch a release by id, including its Lighthouse diagnostics payload.
 *
 * `diagnostics` is null when the audit has not yet landed (~30–60s after
 * go-live). The `lighthouseJsonUrl` inside `diagnostics` is a short-lived
 * signed GET URL re-minted on each call — do not cache the URL.
 *
 * @param releaseId The release id to fetch (e.g. from `getLiveReleaseId`).
 * @throws AdminApiError `release_not_found` (404) — the release id does not
 *   exist or belongs to a different app.
 * @example
 * const { diagnostics } = await admin.diagnostics.getRelease('rel_abc123');
 */
export function getRelease(ctx: AdminContext, releaseId: string) {
  return call<DiagnosticsReleaseResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/releases/${seg(releaseId)}`,
  );
}

/**
 * Fetch the raw Lighthouse JSON report from its signed URL. Uses
 * REPORT_TIMEOUT_MS since the report is a large artifact pulled from object
 * storage.
 *
 * @param url The short-lived signed URL from `diagnostics.lighthouseJsonUrl`.
 * @example
 * const report = await admin.diagnostics.fetchReport(url);
 */
export async function fetchReport(url: string): Promise<unknown> {
  const res = await fetchWithTimeout(
    url,
    {},
    REPORT_TIMEOUT_MS,
    'Lighthouse report fetch',
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Lighthouse report: HTTP ${res.status}`);
  }
  return res.json();
}
