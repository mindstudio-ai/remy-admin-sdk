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

export interface LiftFromDevParams {
  /**
   * Which dev session to lift from, by dev release id. An app has a dev session per workspace — one
   * per person's box, one per person's CLI — so this is required once more than one is open. The
   * server refuses rather than picking: promoting the wrong workspace's data over live is not
   * recoverable, and nothing in the request would show it had happened.
   *
   * The ids are on the dashboard's `devSessions`, and the `ambiguous_dev_session` error lists them.
   */
  releaseId?: string;
}

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
 *   `no_live_release` (404) — app has never been published (publish first, then lift);
 *   `ambiguous_dev_session` (400) — the app has several dev sessions open, so `releaseId` is
 *   required; the error message lists the open ones.
 * @example
 * const result = await admin.data.liftFromDev();
 * console.log(`Lifted ${result.databasesAffected.length} databases to live`);
 * // With more than one dev session open, name the one you mean:
 * await admin.data.liftFromDev({ releaseId: '8f2c1e04-...' });
 */
export function liftFromDev(ctx: AdminContext, params: LiftFromDevParams = {}) {
  return call<DataLiftFromDevResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/manage/lift-dev-to-live`,
    {
      confirm: true,
      ...(params.releaseId ? { releaseId: params.releaseId } : {}),
    },
  );
}

export interface LiftFromLiveParams {
  /**
   * Empty dev databases in place — clears all rows, keeps schema and IDs,
   * no data read from live. Defaults to false (full copy from live).
   */
  truncate?: boolean;
  /**
   * Which dev session to overwrite, by dev release id. Required once the app has more than one
   * open — see `LiftFromDevParams.releaseId`.
   */
  releaseId?: string;
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
 *   `no_live_release` (404) — no live release (copy mode only; not thrown when `truncate` is true);
 *   `ambiguous_dev_session` (400) — several dev sessions are open, so `releaseId` is required.
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
    {
      confirm: true,
      ...(params.truncate ? { mode: 'truncate' } : {}),
      ...(params.releaseId ? { releaseId: params.releaseId } : {}),
    },
  );
}
