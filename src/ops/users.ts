/**
 * App users operations: list, role management, API key lifecycle.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/users.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  UsersListResult,
  UsersSetRoleResult,
  UsersCreateApiKeyResult,
  UsersRevokeApiKeyResult,
} from '../types/users.js';

export interface UsersListParams {
  /** Max users to return per page (server default 50, clamped to 200). */
  limit?: number;
  /** Zero-based page offset. */
  offset?: number;
}

/**
 * All app-managed users with their roles and masked API-key status.
 *
 * @example
 * const { users } = await admin.users.list({ limit: 20 });
 * const admins = users.filter((u) => u.roles.includes('admin'));
 */
export function list(ctx: AdminContext, params: UsersListParams = {}) {
  return call<UsersListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/users${qs(params as Record<string, string | number | boolean | undefined | null>)}`,
  );
}

/**
 * Replace a user's role set with a single role.
 *
 * Sends `roles: [role]` — the array replaces the user's entire prior role
 * list. The updated user record is returned.
 *
 * @throws AdminApiError `user_not_found` (404) — the user does not belong to
 *   this app; `invalid_roles` (400) — the roles field was malformed.
 * @example
 * const { user } = await admin.users.setRole('usr_abc123', 'admin');
 */
export function setRole(ctx: AdminContext, userId: string, role: string) {
  return call<UsersSetRoleResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/users/${seg(userId)}/roles`,
    { roles: [role] },
  );
}

/**
 * Generate an API key for a user; the full plaintext `key` is returned exactly
 * once — only the masked form is stored after this call.
 *
 * Requires the app's live release to have the `api-key` auth method enabled.
 *
 * @throws AdminApiError `user_not_found` (404) — the user does not belong to
 *   this app; `auth_method_not_enabled` (400) — the `api-key` auth method is
 *   not enabled on the app's live release.
 * @example
 * const { key } = await admin.users.createApiKey('usr_abc123');
 * // Store `key` immediately — it cannot be retrieved again.
 */
export function createApiKey(ctx: AdminContext, userId: string) {
  return call<UsersCreateApiKeyResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/users/${seg(userId)}/api-key`,
  );
}

/**
 * Revoke a user's API key; takes effect immediately — in-flight requests using
 * the key will fail.
 *
 * @throws AdminApiError `user_not_found` (404) — the user does not belong to
 *   this app.
 * @example
 * await admin.users.revokeApiKey('usr_abc123');
 */
export function revokeApiKey(ctx: AdminContext, userId: string) {
  return call<UsersRevokeApiKeyResult>(
    ctx,
    'DELETE',
    `/_internal/v2/apps/${ctx.appId}/users/${seg(userId)}/api-key`,
  );
}
