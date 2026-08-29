/**
 * Response types for the data command group.
 *
 * Sources in youai-api:
 *   POST /manage/lift-dev-to-live   → src/http/routes/V2Apps/manage/liftDevToLive.ts
 *   POST /manage/lift-live-to-dev   → src/http/routes/V2Apps/manage/liftLiveToDev.ts
 */

/** Minimal database descriptor returned inside lift results. */
export interface LiftedDatabase {
  id: string;
  name: string;
}

/**
 * Response from POST /_internal/v2/apps/:appId/manage/lift-dev-to-live.
 * Destructively replaces the live release's databases with the dev release's.
 */
export interface DataLiftFromDevResult {
  /** Unix timestamp (ms) of when the lift completed. */
  liftedAt: number;
  sourceDevReleaseId: string;
  targetLiveReleaseId: string;
  databasesAffected: LiftedDatabase[];
}

/**
 * Response from POST /_internal/v2/apps/:appId/manage/lift-live-to-dev.
 * Replaces the dev release's databases with the live release's, or truncates
 * dev databases when mode is 'truncate'.
 */
export interface DataLiftFromLiveResult {
  /** Unix timestamp (ms) of when the lift completed. */
  liftedAt: number;
  /** 'copy' = live data copied over dev; 'truncate' = dev rows cleared, no live data read. */
  mode: 'copy' | 'truncate';
  /** null when mode is 'truncate' (live release not involved). */
  sourceLiveReleaseId: string | null;
  targetDevReleaseId: string;
  databasesAffected: LiftedDatabase[];
}
