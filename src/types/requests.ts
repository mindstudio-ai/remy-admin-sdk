/**
 * Response types for src/commands/requests.ts.
 * Transcribed from:
 *   - RequestLogDao.list()                      → RequestsListResult
 *   - RequestLogEntry (RequestLogDao.get())      → RequestsGetResult
 *   - MethodMetricsDao.getAppSummary()           → RequestsStatsSummaryResult
 *   - MethodMetricsDao.getMethodTimeSeries()     → RequestsStatsMethodResult
 */

/** One row in the lightweight request list (no input/output/stdout). */
export interface RequestsListRow {
  id: string;
  releaseId: string;
  methodId: string;
  interface: string;
  success: boolean;
  durationMs: number | null;
  userId: string | null;
  createdAt: string;
}

/** GET /_internal/v2/apps/:appId/requests */
export interface RequestsListResult {
  requests: RequestsListRow[];
  nextCursor: string | null;
}

/** Full request log entry (all fields). GET /_internal/v2/apps/:appId/requests/:requestId */
export interface RequestsGetResult {
  id: string;
  appId: string;
  releaseId: string;
  methodId: string;
  interface: string;
  /** Raw method input payload (jsonb). */
  input: unknown;
  /** Raw method output payload (jsonb). */
  output: unknown;
  /** Error object written by the executor (jsonb). */
  error: unknown;
  stdout: string[];
  success: boolean;
  durationMs: number | null;
  userId: string | null;
  /** Interface-specific context (e.g. cron schedule info). */
  interfaceContext: unknown;
  createdAt: string;
}

/** One time-series bucket in the app-summary response (no successCount). */
export interface RequestsStatsSummaryBucket {
  start: string;
  requestCount: number;
  errorCount: number;
  /** null when requestCount === 0 — no latency to average. */
  avgDurationMs: number | null;
}

/** GET /_internal/v2/apps/:appId/metrics/summary */
export interface RequestsStatsSummaryResult {
  buckets: RequestsStatsSummaryBucket[];
  totals: {
    requestCount: number;
    successCount: number;
    errorCount: number;
    avgDurationMs: number;
    /** Avg duration for background interfaces (cron, email, jewel) only. */
    backgroundAvgDurationMs: number;
    /** Total distinct managed users for this app (from appManagedUsersDao). */
    uniqueUsers: number;
  };
  byMethod: Array<{
    methodId: string;
    requestCount: number;
    errorCount: number;
    avgDurationMs: number;
    /** Same time grid as `buckets[]` — positional alignment guaranteed. */
    sparkline: Array<{ requestCount: number; errorCount: number }>;
  }>;
  byErrorType: Array<{
    errorType: string;
    count: number;
    lastSeen: string;
  }>;
  /** Keys are interface names (e.g. 'api', 'agent', 'cron'). */
  byInterface: Record<string, { requestCount: number }>;
}

/** One time-series bucket in the per-method response (includes successCount). */
export interface RequestsStatsMethodBucket {
  start: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  /** null when requestCount === 0 — no latency to average. */
  avgDurationMs: number | null;
}

/** GET /_internal/v2/apps/:appId/metrics/methods/:methodId */
export interface RequestsStatsMethodResult {
  methodId: string;
  buckets: RequestsStatsMethodBucket[];
  totals: {
    requestCount: number;
    successCount: number;
    errorCount: number;
    avgDurationMs: number;
    /** Avg duration for background interfaces (cron, email, jewel) only. */
    backgroundAvgDurationMs: number;
    /** Error counts keyed by error type string (first 50 chars of message). */
    errorsByType: Record<string, number>;
  };
}
