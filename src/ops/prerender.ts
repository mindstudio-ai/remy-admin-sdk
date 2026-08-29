/**
 * Prerender operations: snapshot listing, stored-HTML view, cache invalidation.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/prerender.ts owns the `prerender get` crawler fetch (a public-URL
 * bot-UA fetch that is NOT an authed API call).
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';

import type {
  PrerenderInvalidateResult,
  PrerenderPagesResult,
  PrerenderViewResult,
} from '../types/prerender.js';

export interface PrerenderPagesParams {
  /** Opaque cursor from a previous `pages` response; omit to start from the first page. */
  cursor?: string;
}

export interface PrerenderViewParams {
  /** App path to look up (e.g. `/u/abc123`). Must be non-empty. */
  path: string;
}

export interface PrerenderInvalidateParams {
  /**
   * Paths to purge. Omit (or pass undefined) to purge every snapshot
   * (the `--all` flag). An explicit empty array is the same as --all.
   */
  paths?: string[];
}

/**
 * List stored prerendered snapshots for the live release.
 *
 * Paginated — pass `nextCursor` from the previous response as `cursor` on
 * the next call. Returns `{ releaseId: null, pages: [] }` (not an error)
 * when the app has no live release.
 *
 * @example
 * const { pages } = await admin.prerender.pages();
 * console.log(`${pages.length} snapshots cached`);
 */
export function pages(ctx: AdminContext, params: PrerenderPagesParams = {}) {
  return call<PrerenderPagesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/prerender/pages${qs(params)}`,
  );
}

/**
 * Retrieve the stored snapshot HTML for a single path.
 *
 * Returns JSON (not text/html) so the snapshot cannot execute in the API
 * origin; render the `html` field in a sandboxed iframe if displaying it.
 *
 * @throws AdminApiError `snapshot_not_found` (404) — no snapshot exists for
 *   that path (the path is cold; trigger a render via `prerender get`);
 *   `missing_path` (400) — `path` is empty.
 * @example
 * const { html } = await admin.prerender.view({ path: '/u/abc123' });
 */
export function view(ctx: AdminContext, params: PrerenderViewParams) {
  return call<PrerenderViewResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/prerender/pages/view${qs({ path: params.path })}`,
  );
}

/**
 * Purge one or more prerendered snapshots for the live release.
 *
 * Omit `paths` (or pass `undefined`) to purge every snapshot for the app.
 * An empty array behaves the same as omitting. The next crawler visit to any
 * invalidated path will trigger a fresh render.
 *
 * @example
 * // Purge a specific path:
 * await admin.prerender.invalidate({ paths: ['/u/abc123'] });
 * // Purge all snapshots:
 * await admin.prerender.invalidate();
 */
export function invalidate(
  ctx: AdminContext,
  params: PrerenderInvalidateParams = {},
) {
  const body: Record<string, unknown> = {};
  if (params.paths !== undefined && params.paths.length > 0) {
    body.paths = params.paths;
  }
  return call<PrerenderInvalidateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/prerender/invalidate`,
    body,
  );
}
