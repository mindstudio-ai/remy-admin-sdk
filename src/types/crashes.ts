/**
 * Response types for src/commands/crashes.ts.
 * Transcribed from:
 *   - FrontendErrorMetricsDao.listFingerprintAggregates() +
 *     FrontendErrorsDao.listExamplesByFingerprints()       → CrashesListResult
 *   - FrontendErrorsDao.list()                             → CrashesOccurrencesResult
 *   - FrontendErrorEntry (FrontendErrorsDao.get())         → CrashesGetResult
 *   - FrontendErrorMetricsDao.getTimeSeries()              → CrashesStatsResult
 */

/** Error event type: thrown Error or unhandled Promise rejection. */
export type FrontendErrorType = 'error' | 'unhandledrejection';

/** One row in the grouped crash list (one row per fingerprint). */
export interface CrashGroup {
  fingerprint: string;
  occurrenceCount: number;
  /** Distinct visitor IDs affected (capped at 100 in the metrics table). */
  affectedUsers: number;
  firstSeen: string;
  lastSeen: string;
  type: FrontendErrorType;
  message: string;
  stack: string;
  url: string;
  /** ID of a representative event — pass to `crashes get` for full detail. */
  exampleEventId: string | null;
}

/** GET /_internal/v2/apps/:appId/frontend-errors */
export interface CrashesListResult {
  errors: CrashGroup[];
}

/** Lightweight occurrence row in the per-fingerprint event list. */
export interface CrashOccurrenceRow {
  id: string;
  releaseId: string;
  fingerprint: string;
  type: FrontendErrorType;
  message: string;
  url: string;
  userId: string | null;
  visitorId: string;
  createdAt: string;
}

/** GET /_internal/v2/apps/:appId/frontend-errors/:fingerprint/events */
export interface CrashesOccurrencesResult {
  errors: CrashOccurrenceRow[];
  nextCursor: string | null;
}

/** Full event detail with stack trace and breadcrumbs. GET /_internal/v2/apps/:appId/frontend-errors/events/:errorId */
export interface CrashesGetResult {
  id: string;
  appId: string;
  releaseId: string;
  fingerprint: string;
  type: FrontendErrorType;
  message: string;
  stack: string;
  source: string | null;
  line: number | null;
  column: number | null;
  url: string;
  userAgent: string;
  userId: string | null;
  visitorId: string;
  breadcrumbs: unknown[];
  occurredAt: string;
  createdAt: string;
}

/** One bucket in the crash occurrence time series. */
export interface CrashesStatsBucket {
  start: string;
  occurrenceCount: number;
}

/** GET /_internal/v2/apps/:appId/frontend-errors/metrics/summary */
export interface CrashesStatsResult {
  buckets: CrashesStatsBucket[];
  totals: {
    occurrenceCount: number;
    /** Distinct visitor IDs across all buckets in the time window. */
    affectedUsers: number;
  };
}
