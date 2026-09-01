/**
 * CLI-only streaming passthroughs. All write directly to stdout, which is
 * why they live beside output.ts rather than in the ops core: they are output
 * devices for a terminal, not API calls with a return value. The importable
 * client deliberately does not expose them (SDK v1 is non-streaming).
 */

import type { AdminContext } from './ctx.js';
import {
  REQUEST_TIMEOUT_MS,
  authHeaders,
  fetchWithTimeout,
  readBody,
} from './http.js';
import { fatal } from './errors.js';
import { out } from './output.js';

/** A stream may legitimately run for minutes; bound idle time between chunks. */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * Raw body passthrough to stdout — for endpoints that stream NDJSON (e.g.
 * `jewels export --file`), where each server line is already one JSON value
 * and re-parsing the whole body would buffer it for no reason.
 */
export async function rawToStdout(
  ctx: AdminContext,
  method: string,
  apiPath: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<void> {
  const res = await fetchWithTimeout(
    `${ctx.baseUrl}${apiPath}`,
    { method, headers: authHeaders(ctx) },
    timeoutMs,
    `API ${method} ${apiPath}`,
  );
  if (!res.ok) {
    fatal(
      `API ${method} ${apiPath} returned ${res.status}: ${JSON.stringify(await readBody(res))}`,
    );
  }
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    process.stdout.write(decoder.decode(value, { stream: true }));
  }
}

/** SSE passthrough: each `data:` event is printed as one JSON value. */
export async function streamToStdout(
  ctx: AdminContext,
  apiPath: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Idle timeout, not a total deadline: a long-running method is legitimate,
  // a stream that stops producing is not.
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idled = false;
  const armIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idled = true;
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    armIdleTimer();
    const res = await fetch(`${ctx.baseUrl}${apiPath}`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      fatal(
        `API POST ${apiPath} returned ${res.status}: ${JSON.stringify(await readBody(res))}`,
      );
    }

    if (!res.body) {
      fatal('Stream response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const emit = (line: string) => {
      if (!line.startsWith('data: ')) {
        return;
      }
      try {
        out(JSON.parse(line.slice(6)));
      } catch {
        // skip unparseable SSE lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush the tail: a final event with no trailing newline is still an
        // event, and it is usually the terminal one.
        emit(buffer);
        break;
      }
      armIdleTimer();
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        emit(line);
      }
    }
  } catch (err: any) {
    if (idled || err?.name === 'AbortError') {
      fatal(
        `Stream POST ${apiPath} stalled — no data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
  }
}

/**
 * GET SSE tail: each `data:` frame prints as one JSON value until the server
 * ends the stream. The server bounds the tail itself (`forSeconds`, then a
 * `tail_complete` frame) — that terminal marker is transport, not data, so it
 * is swallowed rather than printed. Keepalive comments count as bytes, so a
 * quiet-but-alive tail survives the idle timer.
 */
export async function tailSseToStdout(
  ctx: AdminContext,
  apiPath: string,
): Promise<void> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idled = false;
  const armIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idled = true;
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  let complete = false;
  try {
    armIdleTimer();
    const res = await fetch(`${ctx.baseUrl}${apiPath}`, {
      method: 'GET',
      headers: { ...authHeaders(ctx), Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    if (!res.ok) {
      fatal(
        `API GET ${apiPath} returned ${res.status}: ${JSON.stringify(await readBody(res))}`,
      );
    }
    if (!res.body) {
      fatal('Tail response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const emit = (line: string) => {
      if (!line.startsWith('data: ')) {
        return;
      }
      try {
        const value = JSON.parse(line.slice(6));
        if (value?.type === 'tail_complete') {
          complete = true;
          return;
        }
        out(value);
      } catch {
        // skip unparseable SSE lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        emit(buffer);
        break;
      }
      armIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        emit(line);
      }
    }
  } catch (err: any) {
    if (complete) {
      return; // server ended the bounded tail; a teardown race is not an error
    }
    if (idled || err?.name === 'AbortError') {
      fatal(
        `Tail GET ${apiPath} stalled — no data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
  }
}
