/**
 * Release operations: list, get, by-commit, dashboard live-release, and the
 * composite waitForCommit op that owns the two poll loops.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError (or a plain Error for application-level failures such as
 * an unexpected non-404 during commit resolve). No printing, no process
 * coupling — the CLI skin in commands/releases.ts and the importable client
 * both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, tryCall, qs, seg } from '../http.js';
import { sleep } from '../sleep.js';
import type {
  ReleasesListResult,
  ReleasesGetResult,
  ReleasesByCommitResult,
  DashboardResult,
  DashboardLiveRelease,
  V2BuildLogEntry,
  V2ReleaseStatus,
} from '../types/releases.js';

export interface ReleasesListParams {
  /** Max releases to return per page (default 20, clamped 1–100). */
  limit?: number;
}

/**
 * Paginated list of releases, newest first (non-dev only).
 *
 * Returns up to `limit` releases. `nextCursor` in the response is non-null
 * when further pages exist; pass it as a raw query parameter to walk all pages.
 *
 * @example
 * const { releases } = await admin.releases.list({ limit: 50 });
 */
export function list(ctx: AdminContext, params: ReleasesListParams = {}) {
  return call<ReleasesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/releases${qs({ limit: params.limit })}`,
  );
}

/**
 * Full detail for a single release by id.
 *
 * Includes build log, methods, interfaces, databases, a short-lived signed
 * commit-diff URL, a signed Lighthouse diagnostics URL, and the async
 * post-deploy progress state.
 *
 * @throws AdminApiError `release_not_found` (404) — no release with that id exists on this app.
 * @example
 * const release = await admin.releases.get('rel_abc123');
 * console.log(release.status, release.buildDurationMs);
 */
export function get(ctx: AdminContext, releaseId: string) {
  return call<ReleasesGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/releases/${seg(releaseId)}`,
  );
}

/**
 * By-commit lookup. Returns the raw tryCall result so callers can tolerate
 * 404s during the resolve-grace window (used internally by waitForCommit and
 * exposed for programmatic callers that want a one-shot lookup).
 *
 * HTTP errors arrive as `{ ok: false, status, body }` rather than thrown —
 * the API returns `invalid_commit_sha` (400) for non-hex input and
 * `release_not_found` (404) when the commit has no release yet.
 *
 * @example
 * const r = await admin.releases.byCommit('91ca67a');
 * if (r.ok) console.log(r.body.status);
 */
export function byCommit(
  ctx: AdminContext,
  commitSha: string,
): Promise<{ ok: boolean; status: number; body: ReleasesByCommitResult }> {
  return tryCall<ReleasesByCommitResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/releases/by-commit/${seg(commitSha)}`,
  );
}

/**
 * The currently-live release, or null when the app has never been published.
 * Fetched from the dashboard endpoint — same source as `releases current`.
 *
 * @example
 * const live = await admin.releases.dashboardLive();
 * if (live) console.log(live.commitSha, live.publishedAt);
 */
export async function dashboardLive(
  ctx: AdminContext,
): Promise<DashboardLiveRelease | null> {
  const dashboard = await call<DashboardResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/dashboard`,
  );
  return dashboard.liveRelease;
}

// ---- waitForCommit internals ----

/**
 * Why a failed build failed.
 *
 * There is no `error` column on a release — when the API marks one failed it
 * appends a build-log entry with phase 'error' carrying the message. The
 * by-commit endpoint returns the plain release row, buildLog included, so the
 * reason is already in hand here.
 */
function buildFailureReason(release: ReleasesByCommitResult): string | null {
  const log: V2BuildLogEntry[] = Array.isArray(release.buildLog)
    ? release.buildLog
    : [];
  const errors = log.filter(
    (entry) => entry?.phase === 'error' && typeof entry.message === 'string',
  );
  return errors.length ? errors[errors.length - 1].message : null;
}

/**
 * Compact, stable projection of a release for the wait result.
 *
 * `previewUrl` is present for a feature-branch build (status 'preview') and is
 * where that build is actually reachable — gated to anyone who can open the app
 * in Remy. Reported as data rather than taught as a URL shape, so the caller
 * never has to construct one.
 */
export interface ReleaseSummary {
  releaseId: string;
  commitSha: string;
  branch: string | null;
  status: V2ReleaseStatus;
  buildDurationMs: number | null;
  publishedAt: string | null;
  previewUrl?: string;
  /** Build failure reason from the last build-log `error` phase entry; only present when status is `failed`. */
  error?: string;
}

function summarizeRelease(release: ReleasesByCommitResult): ReleaseSummary {
  const summary: ReleaseSummary = {
    releaseId: release.id,
    commitSha: release.commitSha,
    branch: release.branch ?? null,
    status: release.status,
    buildDurationMs: release.buildDurationMs ?? null,
    publishedAt: release.publishedAt ?? null,
    ...(release.previewUrl ? { previewUrl: release.previewUrl } : {}),
  };
  if (release.status !== 'failed') {
    return summary;
  }
  return {
    ...summary,
    error:
      buildFailureReason(release) ??
      'Build failed (no error entry in the build log)',
  };
}

/**
 * Terminal outcome of a `waitForCommit` call.
 *
 * `live`       — deployed to the default branch; the app is live.
 * `preview`    — feature-branch build finished; `summary.previewUrl` is set.
 * `failed`     — build error; `summary.error` carries the reason.
 * `superseded` — a newer commit for this app finished first.
 * `timeout`    — timed out before a terminal status; `summary` has the last-known state.
 * `not_found`  — no release registered within the 30s resolve grace.
 */
export type WaitOutcome =
  'live' | 'preview' | 'failed' | 'superseded' | 'timeout' | 'not_found';

export interface WaitForCommitResult {
  /** Terminal outcome; determines which other fields are populated. */
  outcome: WaitOutcome;
  /** Raw release row at the time of resolution; absent for `not_found`. */
  release?: ReleasesByCommitResult;
  /** The summarizeRelease projection; absent for `not_found`. */
  summary?: ReleaseSummary;
  /**
   * Error message string for `not_found` and `timeout` outcomes. The CLI skin
   * incorporates this into the printable output object. For `failed`, the error
   * is already baked into `summary.error` by summarizeRelease.
   */
  error?: string;
}

export interface WaitForCommitParams {
  /** Full or abbreviated (7–40 hex char) git commit SHA; the API matches by prefix. */
  commitSha: string;
  /** Defaults to 300 000 ms (5 min), matching the CLI's --timeout 300 default. */
  timeoutMs?: number;
  /**
   * Called with the exact progress strings the CLI prints via progress():
   *   `waiting for release to be created for ${shortSha}…`
   *   `${status}… (Ns)`
   */
  onProgress?: (message: string) => void;
}

const POLL_MS = 3_000;
const RESOLVE_GRACE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Wait for the release built from a git commit to reach a terminal state.
 *
 * The "publish and wait until live" primitive. Phase 1 resolves the release
 * row by commit SHA, tolerating 404s for up to 30s — a SHA polled immediately
 * after `git push` will briefly 404 while the receive-pack hook registers it,
 * and that is expected. Phase 2 polls every 3s until the release reaches a
 * terminal status or the timeout expires.
 *
 * Possible outcomes:
 *   `live`        — default-branch deploy succeeded; the app is live.
 *   `preview`     — feature-branch build finished; `summary.previewUrl` is the gated URL.
 *   `failed`      — build failed; `summary.error` carries the last build-log error entry.
 *   `superseded`  — a newer commit finished first and this build was skipped.
 *   `timeout`     — `timeoutMs` elapsed before a terminal status; `summary` has the last-known state.
 *   `not_found`   — no release created within the 30s resolve grace; the push may not have
 *                   registered yet, or this SHA never produced a build.
 *
 * `onProgress` is called with a human-readable string on each poll cycle —
 * the exact strings the CLI skin passes to `progress()`, so callers can echo
 * them without reformatting.
 *
 * Throws a plain `Error` (not AdminApiError) only when Phase 1 encounters an
 * unexpected non-404 HTTP error (e.g. a 500 from the API).
 *
 * @example
 * const result = await admin.releases.waitForCommit({
 *   commitSha: '91ca67a',
 *   timeoutMs: 600_000,
 *   onProgress: (msg) => console.error(msg),
 * });
 * if (result.outcome !== 'live' && result.outcome !== 'preview') {
 *   throw new Error(result.error ?? result.outcome);
 * }
 */
export async function waitForCommit(
  ctx: AdminContext,
  params: WaitForCommitParams,
): Promise<WaitForCommitResult> {
  const { commitSha, onProgress } = params;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shortSha = commitSha.slice(0, 8);
  const start = Date.now();

  // Phase 1 — resolve the release for this commit.
  let release: ReleasesByCommitResult;
  while (true) {
    const r = await byCommit(ctx, commitSha);
    if (r.ok) {
      release = r.body;
      break;
    }
    if (r.status !== 404) {
      throw new Error(
        `Failed to resolve release for ${shortSha}: HTTP ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
    if (Date.now() - start > RESOLVE_GRACE_MS) {
      return {
        outcome: 'not_found',
        error: `No release created for commit ${commitSha} within ${RESOLVE_GRACE_MS / 1000}s — either the push hasn't registered yet or this SHA never produced a build`,
      };
    }
    onProgress?.(`waiting for release to be created for ${shortSha}…`);
    await sleep(POLL_MS);
  }

  // Phase 2 — poll status until terminal.
  const SUCCESS = new Set<string>(['live', 'preview']);
  while (true) {
    if (SUCCESS.has(release.status)) {
      return {
        outcome: release.status as 'live' | 'preview',
        release,
        summary: summarizeRelease(release),
      };
    }
    if (release.status === 'failed') {
      return { outcome: 'failed', release, summary: summarizeRelease(release) };
    }
    if (release.status === 'superseded') {
      return {
        outcome: 'superseded',
        release,
        summary: summarizeRelease(release),
      };
    }
    if (Date.now() - start > timeoutMs) {
      return {
        outcome: 'timeout',
        release,
        summary: summarizeRelease(release),
        error: `Timed out after ${timeoutMs / 1000}s (last status: ${release.status})`,
      };
    }
    onProgress?.(
      `${release.status}… (${Math.round((Date.now() - start) / 1000)}s)`,
    );
    await sleep(POLL_MS);
    const r = await byCommit(ctx, commitSha);
    if (r.ok) {
      release = r.body;
    }
    // A transient non-ok keeps the last known release; the timeout guard above
    // still applies, so we don't loop forever on a persistent error.
  }
}
