/**
 * App secrets operations: list, read, write, and delete encrypted key/value pairs.
 *
 * `SecretsSetParams` allows `null` values to explicitly clear an environment's
 * stored value (mapped from the CLI's `--dev-clear` / `--prod-clear` flags).
 * The key presence check (at least one of devValue/prodValue) stays in the skin.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call, seg } from '../http.js';
import type {
  SecretsListResult,
  SecretsGetResult,
  SecretsSetResult,
  SecretsDeleteResult,
} from '../types/secrets.js';

/**
 * List all secret keys for the app (values are not returned — use `get` to
 * retrieve decrypted values for a specific key).
 *
 * @example
 * const { secrets } = await admin.secrets.list();
 * const withProd = secrets.filter((s) => s.hasProdValue);
 */
export function list(ctx: AdminContext) {
  return call<SecretsListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/secrets`,
  );
}

/**
 * Get the decrypted dev and prod values for a secret key.
 *
 * This call is audited as a `secret.reveal` event on the workspace.
 *
 * @throws AdminApiError `secret_not_found` (404).
 * @example
 * const { devValue, prodValue } = await admin.secrets.get('STRIPE_SECRET_KEY');
 */
export function get(ctx: AdminContext, key: string) {
  return call<SecretsGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/secrets/${seg(key)}`,
  );
}

export interface SecretsSetParams {
  /**
   * Value for the dev environment; `null` clears the stored dev value;
   * omitting the field leaves the dev value unchanged.
   */
  devValue?: string | null;
  /**
   * Value for the prod environment; `null` clears the stored prod value;
   * omitting the field leaves the prod value unchanged.
   */
  prodValue?: string | null;
}

/**
 * Create or update a secret's value for dev and/or prod (merge semantics —
 * environments you omit are not changed).
 *
 * Active sandboxes are invalidated so they reprovision with the updated values.
 * Key must match `[A-Z][A-Z0-9_]{0,99}` (validated server-side).
 *
 * @throws AdminApiError `invalid_key` (400) — the key does not match
 *   `[A-Z][A-Z0-9_]{0,99}`; `missing_value` (400) — neither devValue nor
 *   prodValue was provided.
 * @example
 * await admin.secrets.set('STRIPE_SECRET_KEY', { devValue: 'sk_test_…', prodValue: 'sk_live_…' });
 * // Clear just the dev value:
 * await admin.secrets.set('STRIPE_SECRET_KEY', { devValue: null });
 */
export function set(ctx: AdminContext, key: string, params: SecretsSetParams) {
  const body: Record<string, unknown> = {};
  if ('devValue' in params) {
    body.devValue = params.devValue;
  }
  if ('prodValue' in params) {
    body.prodValue = params.prodValue;
  }
  return call<SecretsSetResult>(
    ctx,
    'PUT',
    `/_internal/v2/apps/${ctx.appId}/secrets/${seg(key)}`,
    body,
  );
}

/**
 * Delete a secret entirely (removes both dev and prod values).
 *
 * Active sandboxes are invalidated. Silently succeeds if the key does not
 * exist.
 *
 * @example
 * await admin.secrets.del('OLD_KEY');
 */
export function del(ctx: AdminContext, key: string) {
  return call<SecretsDeleteResult>(
    ctx,
    'DELETE',
    `/_internal/v2/apps/${ctx.appId}/secrets/${seg(key)}`,
  );
}
