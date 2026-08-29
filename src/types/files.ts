/**
 * Response types for the file-storage management API.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/files.ts
 *   src/common/Storage/AppFilesService.ts
 *
 * 204/empty responses surface as `{ ok: true; status: number }` (readBody in api.ts).
 */

/** Shared file metadata — store-relative key, size, content type, last modified. */
export interface FilesFileMeta {
  store: string;
  key: string;
  size?: number;
  contentType?: string;
  /** ISO-8601 last-modified timestamp. */
  updatedAt?: string;
}

/**
 * POST /file-storage/upload-url — presigned S3 POST for a direct upload.
 *
 * createUploadPost returns `{ key, uploadUrl, uploadFields }`, and the route adds
 * the permanent on-domain `url` the object will be readable at once uploaded.
 */
export interface FilesUploadUrlResult {
  key: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
  /** Permanent on-domain URL for the uploaded object (e.g. `https://<app>/_/files/public/<store>/<key>`). */
  url: string;
}

/**
 * GET /file-storage/url — read link for one object.
 *
 * Private → short-lived presigned URL with `expiresAt` (ttl clamped to [60s, 7d]).
 * Public → permanent on-domain URL, no expiry field.
 */
export interface FilesUrlResult {
  url: string;
  /** ISO-8601 expiry timestamp; present for private objects only. */
  expiresAt?: string;
}

/** Scan badge on one object — absent for objects that predate the scan pipeline. */
export interface FilesScanBadge {
  avStatus: string;
  avScannedAt: string | null;
  avSignature: string | null;
  /** Provider-specific AV detail blob. */
  avDetail: unknown;
  piiStatus: string;
  piiScannedAt: string | null;
  /** Provider-specific PII entities blob. */
  piiEntities: unknown;
  /** Provider-specific PII detail blob. */
  piiDetail: unknown;
}

/**
 * GET /file-storage/metadata — object metadata without downloading.
 *
 * Extends FilesFileMeta (etag is surfaced as `checksum`). AV-flagged files
 * return `thumbnailUrl: null` and no `previewUrl`.
 */
export interface FilesStatResult extends FilesFileMeta {
  /** S3 ETag with quotes stripped — the dashboard's copyable checksum. */
  checksum?: string;
  thumbnailUrl: string | null;
  /** Presigned (private) or permanent on-domain (public) URL for the preview pane. Absent for flagged files. */
  previewUrl?: string;
  scan?: FilesScanBadge;
  /** Inline UTF-8 for text-like types under the 256KB preview cap. */
  textPreview?: string;
  truncated?: boolean;
}

/** One entry in a GET /file-storage listing page. */
export interface FilesListEntry extends FilesFileMeta {
  /** Scan badges; absent for objects that predate the scan pipeline. */
  scan?: { avStatus: string; piiStatus: string };
  thumbnailUrl?: string;
  /** Public stores only — permanent on-domain URL (zero-round-trip "Copy link"). */
  url?: string;
}

/**
 * GET /file-storage — paginated object listing for one store.
 *
 * Flat by default; `folders` is only present when `--delimiter` was passed
 * (folder-at-a-time mode). `q` mode (substring search) never returns `folders`.
 */
export interface FilesLsResult {
  files: FilesListEntry[];
  /** Folder mode only — store-relative sub-prefixes (each carries a trailing slash). */
  folders?: { prefix: string }[];
  cursor?: string;
}

/** Per-store object count and total bytes in the summary. */
export interface FilesStoreSummaryEntry {
  store: string;
  access: 'public' | 'private';
  objectCount: number;
  totalBytes: number;
}

/** Scan counts per store — one GROUP BY per bucket in the summary. */
export interface FilesScanStore {
  store: string;
  access: 'public' | 'private';
  /** AV status → count. */
  av: Record<string, number>;
  /** PII status → count. */
  pii: Record<string, number>;
}

/** One AV-flagged object in the summary's flagged list. */
export interface FilesScanFlagged {
  store: string;
  access: 'public' | 'private';
  key: string;
  avSignature: string | null;
  avScannedAt: string | null;
}

/**
 * GET /file-storage/summary — store-level usage and scan rollup.
 *
 * Extends AppFilesSummary with a `scans` sub-object containing per-store
 * AV/PII histograms and up to five freshest flagged entries.
 */
export interface FilesListResult {
  /** Per-(store, access) object counts and bytes. Internal (_-prefixed) stores excluded. */
  stores: FilesStoreSummaryEntry[];
  totalObjects: number;
  totalBytes: number;
  scans: {
    /** AV/PII status histograms per (store, access). */
    stores: FilesScanStore[];
    /** Up to five most-recently-scanned flagged objects across all stores. */
    flagged: FilesScanFlagged[];
  };
}

/**
 * POST /file-storage/delete — always responds 204 (empty body).
 *
 * Surfaces as `{ ok: true; status: number }` via readBody in api.ts.
 */
export interface FilesDeleteResult {
  ok: true;
  status: number;
}
