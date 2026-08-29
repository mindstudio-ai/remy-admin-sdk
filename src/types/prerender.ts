/**
 * Response types for the v2 prerender management endpoints.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/prerender.ts
 *   src/http/routes/V2Apps/serve/static/_helpers/prerender/invalidateSnapshots.ts
 *   src/http/routes/V2Apps/serve/static/_helpers/prerender/snapshotStore.ts
 */

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

/** One stored snapshot entry as returned by the listing endpoint. */
export interface PrerenderPage {
  path: string;
  /** ISO timestamp of when the snapshot was last written. Optional — absent
   *  if the object store did not return a LastModified header. */
  renderedAt?: string;
  /** Snapshot size in bytes. Optional — absent if the object store did not
   *  return a size. */
  bytes?: number;
}

/** Response shape for GET /prerender/pages.
 *  `releaseId` is null when the app has no live release (pages is empty). */
export interface PrerenderPagesResult {
  releaseId: string | null;
  pages: PrerenderPage[];
  /** Cursor to pass on the next call to page through more snapshots.
   *  Absent when this is the last page. */
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

/** Response shape for GET /prerender/pages/view.
 *  Returns JSON (not text/html) so the snapshot HTML cannot execute in the
 *  api origin; the dashboard renders it in a sandboxed iframe. */
export interface PrerenderViewResult {
  path: string;
  html: string;
}

// ---------------------------------------------------------------------------
// invalidate
// ---------------------------------------------------------------------------

/** Response shape for POST /prerender/invalidate.
 *  `purged` is the number of paths explicitly purged, or 'all' when the
 *  entire snapshot prefix was wiped (--all flag / no paths body). */
export interface PrerenderInvalidateResult {
  purged: number | 'all';
}

// ---------------------------------------------------------------------------
// get (public crawler fetch — not an api() call)
// ---------------------------------------------------------------------------

/** Local result type for `prerender get`.
 *  The command fetches the app's public URL with a bot User-Agent and
 *  returns this shape; it does NOT go through api(). */
export interface PrerenderGetResult {
  /** The full URL that was fetched. */
  url: string;
  /** HTTP status code returned by the origin. */
  status: number;
  /** Raw response body (HTML or SPA shell if the snapshot is cold). */
  html: string;
}
