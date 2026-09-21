/**
 * Browser-QA replay recordings: list what the QA agent recorded, and render a
 * replay to an mp4.
 *
 * `ls` is a grouped view over `files.ls` — a replay chunk is an ordinary
 * private file in the app's `qa-recordings` store and needs no endpoint of its
 * own.
 *
 * `export` is the one operation in this SDK that does NOT go through the
 * management API. Rendering a replay means playing it in a real browser and
 * encoding the frames, and the only machine set up to do that is the dev box
 * the recording was made on: it already has the headless Chrome, the rrweb
 * replayer and ffmpeg. So this talks to the sandbox's local sidecar, and says
 * so plainly when there isn't one. (CLI-only paths are established here —
 * `methods invoke --stream`, `jewels export --file` — but this is the first
 * that needs local compute rather than local disk.)
 */

import type { AdminContext } from '../ctx.js';
import { SIDECAR_URL } from '../config.js';
import * as files from './files.js';
import type {
  QaRecordingRun,
  QaRecordingSession,
  QaRecordingsExportResult,
  QaRecordingsLsResult,
} from '../types/qaRecordings.js';

/** The app store QA replay chunks are written to (private). */
export const RECORDING_STORE = 'qa-recordings';

export interface QaRecordingsLsParams {
  /** Only this session. Omitted → every session in the store. */
  sessionId?: string;
  cursor?: string;
  /** Chunk objects to scan, not sessions returned. */
  limit?: number;
}

/**
 * Recording sessions in this app, grouped from the chunk keys.
 *
 * @example
 * const { sessions } = await admin.qaRecordings.ls({});
 * // → [{ sessionId, chunks, bytes, runs: [{ runId, keys }] }]
 */
export async function ls(
  ctx: AdminContext,
  params: QaRecordingsLsParams = {},
): Promise<QaRecordingsLsResult> {
  const page = await files.ls(ctx, {
    store: RECORDING_STORE,
    access: 'private',
    ...(params.sessionId ? { prefix: `${params.sessionId}/` } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  });

  const sessions = new Map<string, QaRecordingSession>();
  for (const entry of page.files) {
    // `{sessionId}/{runId}/{seq}.json`. Anything else is not a chunk — skip it
    // rather than inventing a session for it.
    const parts = entry.key.split('/');
    if (parts.length !== 3) {
      continue;
    }
    const [sessionId, runId] = parts;
    let session = sessions.get(sessionId);
    if (!session) {
      session = { sessionId, chunks: 0, bytes: 0, runs: [] };
      sessions.set(sessionId, session);
    }
    let run = session.runs.find((r: QaRecordingRun) => r.runId === runId);
    if (!run) {
      run = { runId, chunks: 0, bytes: 0, keys: [] };
      session.runs.push(run);
    }
    const size = entry.size ?? 0;
    session.chunks += 1;
    session.bytes += size;
    run.chunks += 1;
    run.bytes += size;
    run.keys.push(entry.key);
    if (entry.updatedAt) {
      if (!session.startedAt || entry.updatedAt < session.startedAt) {
        session.startedAt = entry.updatedAt;
      }
      if (!session.endedAt || entry.updatedAt > session.endedAt) {
        session.endedAt = entry.updatedAt;
      }
    }
  }

  // Keys within a run sort by seq, and sessions by recency — the run somebody
  // just did is the one they are almost always asking about.
  for (const session of sessions.values()) {
    for (const run of session.runs) {
      run.keys.sort((a, b) => seqOf(a) - seqOf(b));
    }
  }
  return {
    store: RECORDING_STORE,
    sessions: [...sessions.values()].sort((a, b) =>
      (b.endedAt ?? '').localeCompare(a.endedAt ?? ''),
    ),
    ...(page.cursor ? { cursor: page.cursor } : {}),
  };
}

function seqOf(key: string): number {
  const n = Number(
    key
      .split('/')
      .pop()
      ?.replace(/\.json$/, ''),
  );
  return Number.isFinite(n) ? n : 0;
}

export interface QaRecordingsExportParams {
  /** The recording session to render (32 hex characters). */
  sessionId: string;
  /** Window of the session, as epoch milliseconds. Both required: a replay is
   *  a slice of a continuous recording, not a file. */
  from: number;
  to: number;
  /** Where the mp4 is written. Defaults to `assets`, public. */
  store?: string;
  access?: 'public' | 'private';
  /** Milliseconds to wait for the render. */
  timeoutMs?: number;
}

// Above the sidecar's own 600s rung so the box's error surfaces rather than a
// severed request (see the ladder in mindstudio-sandbox/src/lsp/sidecar.ts).
const DEFAULT_EXPORT_TIMEOUT_MS = 660_000;

/**
 * Render a window of a recording session to an mp4 on the dev box.
 *
 * Blocks for the whole render — the clip plays in real time, then encodes and
 * uploads — and answers with where the video landed. Runs only on a Remy dev
 * box, since that is where the browser and ffmpeg are.
 *
 * @example
 * const { url } = await admin.qaRecordings.exportVideo({
 *   sessionId, from: 1758000000000, to: 1758000042000,
 * });
 */
export async function exportVideo(
  _ctx: AdminContext,
  params: QaRecordingsExportParams,
): Promise<QaRecordingsExportResult> {
  const body = {
    recordingSessionId: params.sessionId,
    startTs: params.from,
    endTs: params.to,
    ...(params.store ? { store: params.store } : {}),
    ...(params.access ? { access: params.access } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}/export-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        params.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS,
      ),
    });
  } catch (err) {
    // Nothing listening is the common case and has a specific cause worth
    // naming, rather than surfacing ECONNREFUSED at the user. Not an
    // AdminApiError: this never reached an API.
    throw new Error(
      `Could not reach the sandbox at ${SIDECAR_URL} ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        'Rendering a replay needs the dev box that recorded it — this ' +
        'command only works inside a Remy sandbox.',
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!res.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : `The sandbox refused the export (HTTP ${res.status}).`,
    );
  }
  const status = payload.export as QaRecordingsExportResult | undefined;
  if (!status) {
    throw new Error(
      'The sandbox accepted the export but reported no result. Check the ' +
        "box's tunnel logs.",
    );
  }
  // A render that ran and failed is a RESULT, not an exception — it carries a
  // reason and an error code the caller may want to branch on (FFMPEG_
  // UNAVAILABLE, CANCELLED). The CLI skin turns a non-completed status into a
  // non-zero exit; an importing caller inspects `status`.
  return status;
}
