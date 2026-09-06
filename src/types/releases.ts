/**
 * Response types for the releases command group.
 *
 * Sources in youai-api:
 *   GET /releases                  → src/http/routes/V2Apps/manage/releases.ts
 *   GET /releases/:releaseId       → src/http/routes/V2Apps/manage/dashboard.ts
 *   GET /releases/by-commit/:sha   → src/http/routes/V2Apps/manage/dashboard.ts
 *   GET /dashboard                 → src/http/routes/V2Apps/manage/dashboard.ts
 */

export interface V2CommitInfo {
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
}

export interface V2BuildStats {
  methodCount?: number;
  methodsBundleSizeBytes?: number;
  interfaceCount?: number;
  tableCount?: number;
}

export interface V2BuildLogEntry {
  ts: number;
  phase: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/** Terminal and in-progress states a release moves through. */
export type V2ReleaseStatus =
  | 'building'
  | 'compiled'
  | 'live'
  | 'preview'
  | 'dev'
  | 'failed'
  | 'superseded';

/**
 * Why a failed release failed — derived server-side from the build log
 * (describeReleaseFailure() in youai-api) and present on every release
 * shape. All three are null unless `status` is 'failed'.
 *
 * `failureKind` is the field to branch on:
 *   'interrupted' — the build's orchestrator died (platform restart); the
 *                   platform retries once automatically. Transient.
 *   'unbuildable' — the commit couldn't be read as an app (mindstudio.json
 *                   missing/invalid). Fix the commit; nothing to retry.
 *   'build'       — the build itself failed (compile error, deploy step).
 */
export interface ReleaseFailureFields {
  failureReason: string | null;
  /** Build stage that was running when it failed (`interfaces`, `promote`…). */
  failurePhase: string | null;
  failureKind: 'build' | 'interrupted' | 'unbuildable' | null;
}

/**
 * Lightweight release projection returned by the paginated list endpoint.
 * Heavy fields (buildLog, manifest, methods, interfaces) are dropped.
 * Produced by toReleaseFragment() in youai-api.
 */
export interface ReleaseFragment extends ReleaseFailureFields {
  id: string;
  commitSha: string;
  commitInfo: V2CommitInfo;
  status: V2ReleaseStatus;
  branch: string | null;
  buildDurationMs: number | null;
  buildStats: V2BuildStats | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  /** Release-pinned preview URL; null when status is not 'preview'. */
  previewUrl: string | null;
}

/**
 * Response from GET /_internal/v2/apps/:appId/releases.
 * Paginated on (created_at DESC, id DESC) using an opaque base64url cursor.
 */
export interface ReleasesListResult {
  releases: ReleaseFragment[];
  /** Opaque keyset cursor; null when no further pages remain. */
  nextCursor: string | null;
}

/**
 * Full release returned by GET /_internal/v2/apps/:appId/releases/:releaseId.
 * Includes build log, databases, signed diff/diagnostics URLs, and the
 * post-deploy async progress signal.
 */
export interface ReleasesGetResult extends ReleaseFailureFields {
  id: string;
  appId: string;
  commitSha: string;
  commitInfo: V2CommitInfo;
  commitDiffS3Key: string | null;
  branch: string | null;
  status: V2ReleaseStatus;
  /** Immutable environment kind stamped at creation. Null for pre-column rows. */
  kind: 'live' | 'preview' | 'dev' | null;
  buildLog: V2BuildLogEntry[];
  manifest: Record<string, unknown>;
  methods: unknown[];
  interfaces: unknown[];
  deps: unknown | null;
  pendingEffects: Record<string, unknown>;
  stagingVersionId: string | null;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  buildDurationMs: number | null;
  buildStats: V2BuildStats | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  autoRetryOf: string | null;
  databases: unknown[];
  /** Short-lived signed URL for the commit diff object; null if no diff. */
  commitDiffUrl: string | null;
  /** Frontend diagnostics with a signed Lighthouse report URL; null if none. */
  diagnostics: Record<string, unknown> | null;
  /** Post-deploy async progress state. */
  postDeploy: { state: unknown };
  /** Canonical public URL the app is currently served on. */
  primaryUrl: string;
  /** Release-pinned preview URL; null when not a preview release. */
  previewUrl: string | null;
  /** Branch-following URL that tracks the latest preview on this branch. */
  branchUrl: string | null;
}

/**
 * Response from GET /_internal/v2/apps/:appId/releases/by-commit/:sha.
 * Plain release row — no databases/diff enrichment — plus previewUrl.
 * Used by 'releases wait', which polls this endpoint in a loop.
 */
export interface ReleasesByCommitResult extends ReleaseFailureFields {
  id: string;
  appId: string;
  commitSha: string;
  commitInfo: V2CommitInfo;
  commitDiffS3Key: string | null;
  branch: string | null;
  status: V2ReleaseStatus;
  /** Immutable environment kind stamped at creation. Null for pre-column rows. */
  kind: 'live' | 'preview' | 'dev' | null;
  buildLog: V2BuildLogEntry[];
  manifest: Record<string, unknown>;
  methods: unknown[];
  interfaces: unknown[];
  deps: unknown | null;
  pendingEffects: Record<string, unknown>;
  stagingVersionId: string | null;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  buildDurationMs: number | null;
  buildStats: V2BuildStats | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  autoRetryOf: string | null;
  /**
   * Release-pinned preview URL when status is 'preview'; null otherwise.
   * Synthesised synchronously from the release id by buildPreviewUrl().
   */
  previewUrl: string | null;
}

/** A compiled method entry as it appears on a live release. */
export interface DashboardReleaseMethod {
  id: string;
  name: string;
  description?: string;
  path: string;
  export: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/**
 * The liveRelease field on the dashboard response — a full release row
 * enriched with databases, a signed diff URL, and frontend diagnostics.
 */
export interface DashboardLiveRelease {
  id: string;
  appId: string;
  commitSha: string;
  commitInfo: V2CommitInfo;
  commitDiffS3Key: string | null;
  branch: string | null;
  status: V2ReleaseStatus;
  kind: 'live' | 'preview' | 'dev' | null;
  buildLog: V2BuildLogEntry[];
  manifest: Record<string, unknown>;
  methods: DashboardReleaseMethod[];
  interfaces: unknown[];
  deps: unknown | null;
  pendingEffects: Record<string, unknown>;
  stagingVersionId: string | null;
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  buildDurationMs: number | null;
  buildStats: V2BuildStats | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  autoRetryOf: string | null;
  databases: unknown[];
  commitDiffUrl: string | null;
  diagnostics: Record<string, unknown> | null;
}

/**
 * Response from GET /_internal/v2/apps/:appId/dashboard.
 * Only the fields used by this CLI are typed; the full shape
 * (interfaces detail, previewReleases, devSession) is wider.
 */
export interface DashboardResult {
  appId: string;
  customSubdomain: string | null;
  primaryUrl: string;
  metadata: Record<string, unknown>;
  liveRelease: DashboardLiveRelease | null;
  releases: ReleaseFragment[];
  interfaces: Record<string, unknown>;
  previewReleases: unknown[];
  devSession: Record<string, unknown>;
}
