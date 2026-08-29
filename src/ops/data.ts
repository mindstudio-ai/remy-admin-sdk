/**
 * Database sync operations: lift dev→live and live→dev.
 *
 * Ops are pure: (ctx, params) → typed result. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call } from '../http.js';
import type {
  DataLiftFromDevResult,
  DataLiftFromLiveResult,
} from '../types/data.js';

/**
 * Destructively copy every dev-release database over the live-release databases.
 *
 * Whole-DB overwrite by name match, including auth tables — wipes whatever
 * live had, including signed-up users. Intended for first-publish / pre-launch
 * data sync only; do not run on a production app with real users. Writes an
 * audit row tagged `lift-dev-to-live`. The CLI skin requires the literal appId
 * AND `--confirm` as a double-gate; the op always sends `{ confirm: true }`.
 *
 * @throws AdminApiError `no_dev_session` (404) — no dev release exists (start a dev session first);
 *   `no_live_release` (404) — app has never been published (publish first, then lift).
 * @example
 * const result = await admin.data.liftFromDev();
 * console.log(`Lifted ${result.databasesAffected.length} databases to live`);
 */
export function liftFromDev(ctx: AdminContext) {
  return call<DataLiftFromDevResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/manage/lift-dev-to-live`,
    { confirm: true },
  );
}

export interface LiftFromLiveParams {
  /**
   * Empty dev databases in place — clears all rows, keeps schema and IDs,
   * no data read from live. Defaults to false (full copy from live).
   */
  truncate?: boolean;
}

/**
 * Destructively replace dev-release databases with the live-release databases,
 * or truncate dev databases without reading from live.
 *
 * Only dev is overwritten — live/prod data is never touched. Useful for
 * reproducing a prod bug against real data or re-syncing a stale sandbox.
 * With `truncate: true` it instead empties the dev databases (keeps schema
 * and IDs, no data read from live). Writes an audit row tagged
 * `lift-live-to-dev`.
 *
 * @throws AdminApiError `no_dev_session` (404) — no dev release exists (start a dev session first);
 *   `no_live_release` (404) — no live release (copy mode only; not thrown when `truncate` is true).
 * @example
 * // Pull live data into dev for debugging:
 * await admin.data.liftFromLive();
 * // Or just empty dev without pulling from live:
 * await admin.data.liftFromLive({ truncate: true });
 */
export function liftFromLive(
  ctx: AdminContext,
  params: LiftFromLiveParams = {},
) {
  return call<DataLiftFromLiveResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/manage/lift-live-to-dev`,
    { confirm: true, ...(params.truncate ? { mode: 'truncate' } : {}) },
  );
}
