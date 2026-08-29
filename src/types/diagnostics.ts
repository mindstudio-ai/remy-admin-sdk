/**
 * Response types for src/commands/diagnostics.ts.
 * Transcribed from:
 *   - dashboard.ts GET /dashboard (partial view — only liveRelease.id is read)
 *   - dashboard.ts GET /releases/:releaseId (partial view — only diagnostics is read)
 *   - FrontendDiagnosticsDao + withSignedDiagnosticsReport (the diagnostics sub-object shape)
 */

/** Lighthouse category scores (0–1 normalised, or null if the audit did not run). */
export interface DiagnosticsLighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

/** One failing Lighthouse audit item in the distilled summary. */
export interface DiagnosticsFinding {
  id: string;
  title: string;
  score: number;
  displayValue: string | null;
  category: string | null;
}

export interface DiagnosticsRuntimeFindings {
  consoleErrors: Array<{
    source: string | null;
    description: string | null;
    url: string | null;
  }>;
  failedRequests: Array<{ url: string | null; statusCode: number }>;
}

/**
 * The Lighthouse test conditions that produced the scores. Surfaced so a reader
 * can interpret them — a throttled-mobile 54 is not comparable to a desktop run.
 * `runs` is the per-run spread (median-of-N) so noise / host contention is visible.
 */
export interface DiagnosticsAuditEnvironment {
  formFactor: string | null;
  throttlingMethod: string | null;
  throttling: {
    rttMs: number | null;
    throughputKbps: number | null;
    /** Applied CPU multiplier, calibrated per runner (not necessarily Lighthouse's default 4×). */
    cpuSlowdownMultiplier: number | null;
  } | null;
  benchmarkIndex: number | null;
  referenceBenchmarkIndex: number | null;
  calibrated: boolean;
  lighthouseVersion: string | null;
  runs: Array<{ performance: number | null }>;
}

/**
 * The diagnostics sub-object on a release. `lighthouseJsonKey` is stripped
 * server-side; `lighthouseJsonUrl` is a short-lived signed GET URL in its place
 * (re-minted on each call — do not cache the URL).
 */
export interface DiagnosticsPayload {
  id: string;
  appId: string;
  releaseId: string;
  url: string | null;
  lighthouseScores: DiagnosticsLighthouseScores | null;
  /** Distilled list of failing audits for the builder agent. */
  summary: DiagnosticsFinding[] | null;
  runtimeFindings: DiagnosticsRuntimeFindings | null;
  /** Short-lived signed GET URL for the raw Lighthouse JSON report. */
  lighthouseJsonUrl: string | null;
  screenshotUrl: string | null;
  environment: DiagnosticsAuditEnvironment | null;
  /** 'success' | 'error' */
  status: string;
  error: string | null;
  createdAt: string;
}

/**
 * Partial view of GET /_internal/v2/apps/:appId/dashboard.
 * Only `liveRelease.id` is read by the diagnostics command; the full
 * dashboard payload contains many additional fields not represented here.
 */
export interface DiagnosticsDashboardResult {
  liveRelease: { id: string } | null;
}

/**
 * Partial view of GET /_internal/v2/apps/:appId/releases/:releaseId.
 * Only `diagnostics` is read by the diagnostics command; the full release
 * payload contains many additional fields not represented here.
 */
export interface DiagnosticsReleaseResult {
  diagnostics: DiagnosticsPayload | null;
}
