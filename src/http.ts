/**
 * The authed HTTP core under every operation, context-bound and process-free:
 * it throws typed errors (AdminApiError / AdminTimeoutError) and never prints
 * or exits, so the same functions serve the CLI and the importable client.
 *
 * Two entry points, because ops need two failure shapes: `call` throws on a
 * bad status (most ops), `tryCall` returns the status so a caller can tolerate
 * one (releases waitForCommit polls through 404s). The CLI-only raw/SSE
 * passthroughs live in cliStream.ts — they are output devices, not API calls.
 */

import type { AdminContext } from './ctx.js';
import { AdminApiError, AdminTimeoutError } from './errors.js';

/** Bound one request, so a hung API call can't hang the caller indefinitely. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** The raw Lighthouse report is a large artifact pulled from object storage. */
export const REPORT_TIMEOUT_MS = 60_000;

/** Percent-encode one URL path segment. */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Query string ('' or '?a=1&b=2') from a params object; undefined/null values
 * are skipped. The ops-side counterpart of the CLI's Args.query().
 *
 * Takes `object` rather than a Record so ops can pass their typed params
 * interfaces directly (interfaces lack index signatures, so a Record
 * constraint would force a cast at every call site).
 */
export function qs(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function authHeaders(ctx: AdminContext): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Read a response body without assuming it is JSON.
 *
 * A 204 or an empty body is a legitimate success for the DELETE endpoints
 * (`secrets delete`, `users revoke-api-key`). res.json() throws on those, which
 * turned a successful mutation into a reported failure.
 */
export async function readBody(res: Response): Promise<any> {
  if (res.status === 204) {
    return { ok: true, status: 204 };
  }
  const text = await res.text().catch(() => '');
  if (!text.trim()) {
    return { ok: true, status: res.status };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      throw new AdminTimeoutError(label, timeoutMs);
    }
    throw err;
  }
}

/**
 * `T` is the endpoint's response shape, transcribed from the youai-api route
 * in `src/types/`. Defaults to `unknown` so an unannotated call site that
 * touches the result fails to compile rather than silently going untyped.
 * Note: 204/empty responses surface as `{ ok: true, status }` (see readBody) —
 * delete-style result types reflect that, not the route's (absent) JSON.
 */
export async function call<T = unknown>(
  ctx: AdminContext,
  method: string,
  apiPath: string,
  body?: Record<string, unknown>,
  // Ops that hold the request for a full method/jewel run (jewels resolve
  // --approve, jewels dryrun) pass their own bound.
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchWithTimeout(
    `${ctx.baseUrl}${apiPath}`,
    {
      method,
      headers: authHeaders(ctx),
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    timeoutMs,
    `API ${method} ${apiPath}`,
  );

  if (!res.ok) {
    throw new AdminApiError(method, apiPath, res.status, await readBody(res));
  }

  return readBody(res);
}

/**
 * Like `call`, but never throws on an HTTP status — returns a structured
 * result so a caller can react to one (e.g. tolerate a 404 while a release
 * row is still being created after a push).
 */
export async function tryCall<T = unknown>(
  ctx: AdminContext,
  method: string,
  apiPath: string,
): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetchWithTimeout(
    `${ctx.baseUrl}${apiPath}`,
    { method, headers: authHeaders(ctx) },
    REQUEST_TIMEOUT_MS,
    `API ${method} ${apiPath}`,
  );
  return { ok: res.ok, status: res.status, body: await readBody(res) };
}

/** @internal Exposed for cliStream.ts, which shares the auth header shape. */
export { authHeaders };
