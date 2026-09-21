/**
 * Response types for browser-QA replay recordings.
 *
 * Chunks are ordinary private files in the app's `qa-recordings` store, keyed
 * `{sessionId}/{runId}/{seq}.json`, so `ls` here is a grouped view over
 * `files.ls` rather than its own endpoint. Transcribed from youai-api:
 *   src/http/routes/V2Apps/develop/recordings.ts
 *   src/common/Recordings/sessions.ts
 *
 * Export is the exception — it renders on the dev box (see ../ops/recordings).
 */

/** One document lifetime within a session: a page load and everything after it
 *  until the next one. Its lowest-seq chunk carries the rrweb FullSnapshot. */
export interface QaRecordingRun {
  runId: string;
  chunks: number;
  bytes: number;
  /** Store-relative keys, in seq order. */
  keys: string[];
}

/** One recording session — a single tunnel process's continuous recording. */
export interface QaRecordingSession {
  sessionId: string;
  chunks: number;
  bytes: number;
  /** ISO-8601, from the chunk objects' last-modified times. */
  startedAt?: string;
  endedAt?: string;
  runs: QaRecordingRun[];
}

export interface QaRecordingsLsResult {
  store: string;
  sessions: QaRecordingSession[];
  /** Present when the listing was truncated — pass it back as `cursor`. */
  cursor?: string;
}

export interface QaRecordingsExportResult {
  jobId: string;
  status: 'completed' | 'failed' | 'cancelled';
  /** Public target only. A private one gives `store`/`key`; sign it with
   *  `files sign` when you want a link. */
  url?: string;
  store?: string;
  key?: string;
  width?: number;
  height?: number;
  /** Length of the rendered clip, dead air already collapsed. */
  durationMs?: number;
  error?: string;
  errorCode?: string;
}
