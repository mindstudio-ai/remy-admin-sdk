/**
 * App domain operations: platform subdomain + custom hostnames.
 *
 * `findHostname` resolves a user-supplied hostname to its row id and full
 * entry (list → match → id). It throws a plain Error with the exact
 * "not found" message the CLI historically surfaced — the entry-point catch
 * prints `.message` identically whether it came from `fatal()` or here.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call, seg } from '../http.js';
import type {
  DomainsCustomHostnameView,
  DomainsCustomListResult,
  DomainsCustomAddResult,
  DomainsCustomCheckResult,
  DomainsCustomRemoveResult,
  DomainsCustomRetryResult,
  DomainsGetResult,
  DomainsSetResult,
  DomainsCheckResult,
} from '../types/domains.js';

/**
 * Get the app's current platform subdomain (e.g. `my-app.madewithremy.com`).
 *
 * Returns `{ subdomain: null }` when none is set.
 *
 * @example
 * const { subdomain } = await admin.domains.get();
 */
export function get(ctx: AdminContext) {
  return call<DomainsGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-subdomain`,
  );
}

/**
 * Set the app's platform subdomain.
 *
 * @param subdomain The desired subdomain (hyphenated, no suffix).
 * @example
 * await admin.domains.set('my-app');
 */
export function set(ctx: AdminContext, subdomain: string) {
  return call<DomainsSetResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-subdomain`,
    { subdomain },
  );
}

/**
 * Check whether a platform subdomain is available before calling `set`.
 *
 * @example
 * const { isAvailable } = await admin.domains.check('my-app');
 */
export function check(ctx: AdminContext, subdomain: string) {
  return call<DomainsCheckResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-subdomain/check-availability`,
    { subdomain },
  );
}

/**
 * List all custom hostnames registered on the app.
 *
 * Results come from a Cloudflare-synced cache that can be up to ~5 minutes
 * stale. Use `customRetry` to force a synchronous re-check after the customer
 * adds DNS records. `uiStatus` values: `waiting_for_dns | issuing_ssl | live |
 * action_needed | reconnecting`.
 *
 * @example
 * const { hostnames } = await admin.domains.customList();
 * const live = hostnames.filter((h) => h.uiStatus === 'live');
 */
export function customList(ctx: AdminContext) {
  return call<DomainsCustomListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-domains`,
  );
}

/**
 * Register a custom hostname on the app.
 *
 * Apex input (e.g. `acme.com`) auto-creates the `www.acme.com` pair and
 * returns both entries. `dnsInstructions` on each returned entry contains
 * the DNS records the customer must add to their provider.
 *
 * @throws AdminApiError `invalid_hostname` (400) — the hostname failed format
 *   validation; `hostname_in_use` (400) — the hostname (or its auto-paired
 *   www) is already registered on any app.
 * @example
 * const { hostnames } = await admin.domains.customAdd('acme.com');
 * // hostnames[0] = apex row, hostnames[1] = www pair
 */
export function customAdd(ctx: AdminContext, hostname: string) {
  return call<DomainsCustomAddResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-domains`,
    { hostname },
  );
}

/**
 * Preflight a hostname before registering: validates format, checks
 * availability, and signals whether an apex would auto-pair www.
 *
 * Never throws — invalid input returns `{ valid: false, errorMessage }`.
 *
 * @example
 * const { valid, willAutoPairWww } = await admin.domains.customCheck('acme.com');
 */
export function customCheck(ctx: AdminContext, hostname: string) {
  return call<DomainsCustomCheckResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-domains/check-domain`,
    { hostname },
  );
}

/**
 * Resolve a hostname entry by name: lists all hostnames and matches on the
 * canonical lowercase hostname, returning the row id and full entry.
 *
 * @throws Error `No custom domain "${hostname}" found on this app` when the
 *   hostname is not registered.
 * @example
 * const { id, entry } = await admin.domains.findHostname('app.acme.com');
 */
export async function findHostname(
  ctx: AdminContext,
  hostname: string,
): Promise<{ id: string; entry: DomainsCustomHostnameView }> {
  const wanted = hostname.toLowerCase();
  const res = await customList(ctx);
  const entry = (res.hostnames ?? []).find(
    (h) => typeof h.hostname === 'string' && h.hostname === wanted,
  );
  if (!entry) {
    throw new Error(`No custom domain "${hostname}" found on this app`);
  }
  return { id: entry.id, entry };
}

/**
 * Remove a custom hostname from the app.
 *
 * Apex hostnames also remove their paired `www.` entry. The hostname is
 * resolved internally via `findHostname` before the delete call.
 *
 * @throws Error `No custom domain "${hostname}" found on this app` when not
 *   registered; AdminApiError `not_found` (404) if the resolved id has gone
 *   stale.
 * @example
 * await admin.domains.customRemove('acme.com');
 */
export async function customRemove(ctx: AdminContext, hostname: string) {
  const { id } = await findHostname(ctx, hostname);
  return call<DomainsCustomRemoveResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-domains/${seg(id)}/delete`,
  );
}

/**
 * Re-trigger Cloudflare validation for a hostname, typically after the
 * customer has updated their DNS records.
 *
 * @throws Error `No custom domain "${hostname}" found on this app` when not
 *   registered; AdminApiError `not_found` (404) if the resolved id has gone
 *   stale; `no_cf_id` (400) — the hostname was never registered with
 *   Cloudflare and cannot be retried.
 * @example
 * const { hostname: updated } = await admin.domains.customRetry('app.acme.com');
 */
export async function customRetry(ctx: AdminContext, hostname: string) {
  const { id } = await findHostname(ctx, hostname);
  return call<DomainsCustomRetryResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/custom-domains/${seg(id)}/retry`,
  );
}
