/**
 * Methods operations: list (via dashboard) and invoke.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/methods.ts owns streaming (--stream → cliStream.streamToStdout)
 * and user-facing error messages.
 */

import type { AdminContext } from '../ctx.js';
import { call, seg } from '../http.js';
import type {
  DashboardResult,
  DashboardReleaseMethod,
} from '../types/releases.js';
import type { MethodsInvokeResult } from '../types/methods.js';

export interface MethodsInvokeParams {
  /** The method's compiled id (e.g. `mth_abc123`), as shown by `methods.list`. */
  methodId: string;
  /** Input payload forwarded to the method as its first argument. */
  input: Record<string, unknown>;
  /** Present when --roles or --user-id is set; routes through /invoke-as. */
  impersonate?: { roles?: string[]; userId?: string };
}

/**
 * List methods available on the live release.
 *
 * Fetches the dashboard endpoint and unwraps `liveRelease.methods`. Throws a
 * plain `Error` (not AdminApiError) when the app has no live release —
 * message: `"No live release — publish first."`.
 *
 * @example
 * const methods = await admin.methods.list();
 * const target = methods.find((m) => m.id === 'mth_abc123');
 */
export async function list(
  ctx: AdminContext,
): Promise<DashboardReleaseMethod[]> {
  const dashboard = await call<DashboardResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/dashboard`,
  );
  const release = dashboard.liveRelease;
  if (!release) {
    throw new Error('No live release — publish first.');
  }
  return release.methods ?? [];
}

/**
 * Invoke a method and return its output (non-streaming).
 *
 * Routes to `/invoke-as` when `impersonate` is set (either `roles` or
 * `userId` provided), allowing role-gated methods to be tested without
 * spec edits. The streaming path in the CLI skin calls
 * `cliStream.streamToStdout` with the same path/body construction.
 *
 * @throws AdminApiError `missing_impersonation` (400) — `impersonate` object
 *   is malformed; `invalid_impersonation` (400) — `impersonate.userId` or
 *   `impersonate.roles` has a bad type, or neither field is populated.
 * @example
 * const { output } = await admin.methods.invoke({
 *   methodId: 'mth_abc123',
 *   input: { query: 'hello' },
 * });
 */
export function invoke(ctx: AdminContext, params: MethodsInvokeParams) {
  const { methodId, input, impersonate } = params;
  const useImpersonate =
    impersonate !== undefined &&
    (impersonate.roles !== undefined || impersonate.userId !== undefined);
  const apiPath = useImpersonate
    ? `/_internal/v2/apps/${ctx.appId}/methods/${seg(methodId)}/invoke-as`
    : `/_internal/v2/apps/${ctx.appId}/methods/${seg(methodId)}/invoke`;
  const body: Record<string, unknown> = useImpersonate
    ? { input, impersonate }
    : { input };
  return call<MethodsInvokeResult>(ctx, 'POST', apiPath, body);
}
