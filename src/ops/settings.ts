/**
 * App settings operations: get and update the app's v2_settings jsonb.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/settings.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call } from '../http.js';
import type { SettingsResult, V2AppSettings } from '../types/settings.js';

/**
 * Get all V2AppSettings for this app.
 *
 * Returns the current state of every dashboard-controlled toggle: signup
 * allowlist, test accounts, frame-ancestors, disposable-email blocking,
 * telemetry capture, and more. See `V2AppSettings` in `types/settings.ts`
 * for the full field set and per-field semantics.
 *
 * @example
 * const settings = await admin.settings.getSettings();
 * console.log(settings.blockDisposableEmails);
 */
export function getSettings(ctx: AdminContext): Promise<V2AppSettings> {
  return call<SettingsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/settings/v2`,
  ).then((res) => res.settings ?? {});
}

// `partial` stays loose on purpose: `settings set` forwards an arbitrary
// user-supplied key for the route to validate, so a V2AppSettings-typed body
// would reject exactly the escape hatch the command exists to provide.
/**
 * Apply a partial update to the app's V2AppSettings.
 *
 * The server validates and normalizes security-shaped values before writing:
 * signup-allowlist entries must be `*@domain.com` or `user@domain.com`; test
 * accounts require a valid email or E.164 identifier and a 6-digit code (max
 * 5 entries); frame-ancestor entries must be exact `https://` origins (max
 * 25). Unknown keys in `partial` are silently dropped. Returns the full
 * settings after the update.
 *
 * `partial` is deliberately untyped: the CLI escape-hatch `settings set`
 * forwards arbitrary keys for the route to validate; a strict `V2AppSettings`
 * body would reject that use.
 *
 * @throws AdminApiError `invalid_signup_allowlist` (400) — malformed entry or
 *   non-array value; `invalid_test_accounts` (400) — invalid identifier/code,
 *   duplicate identifier, or over the 5-entry cap;
 *   `invalid_frame_ancestors` (400) — not a valid https origin or over the
 *   25-entry cap.
 * @example
 * const updated = await admin.settings.updateSettings({ blockDisposableEmails: false });
 */
export function updateSettings(
  ctx: AdminContext,
  partial: Record<string, unknown>,
): Promise<V2AppSettings> {
  return call<SettingsResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/v2`,
    partial,
  ).then((res) => res.settings ?? {});
}
