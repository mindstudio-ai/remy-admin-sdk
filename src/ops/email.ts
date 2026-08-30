/**
 * Email operations: outbound delivery log, blast stats, suppression list,
 * inbound inbox, and custom domain management (both directions).
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/email.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  EmailBatchResult,
  EmailBatchesResult,
  EmailDomainBase,
  EmailInboxResult,
  EmailListResult,
  EmailMessageResult,
  EmailSendingStatusResult,
  EmailStatsResult,
  EmailSuppressResult,
  EmailSuppressionsResult,
  EmailUnsuppressResult,
  InboundEmailDomainAddResult,
  InboundEmailDomainCheckResult,
  InboundEmailDomainDeleteResult,
  InboundEmailDomainVerifyResult,
  InboundEmailDomainsListResult,
  OutboundEmailDomainAddResult,
  OutboundEmailDomainCheckResult,
  OutboundEmailDomainDeleteResult,
  OutboundEmailDomainVerifyResult,
  OutboundEmailDomainsListResult,
} from '../types/email.js';

// ---------------------------------------------------------------------------
// Param interfaces
// ---------------------------------------------------------------------------

export interface EmailListParams {
  /**
   * Comma-separated statuses to include. Values: `suppressed`, `failed`,
   * `sent`, `delivered`, `blocked`, `bounced`, `complained`, `delayed`,
   * `rejected`. Default: all statuses. `blocked` means an SES suppression list
   * dropped the message before delivery — usually this app's OWN tenant list
   * (a prior hard bounce or spam report from that address), occasionally the
   * shared account-wide list. `unsuppress` reports which.
   */
  status?: string;
  /** Origin to filter by: `method` (app-sent) or `auth` (sign-in codes). Default: all. */
  kind?: string;
  /**
   * Exact-match recipient address (index-backed, fast). Use `search` for
   * partial or substring matches instead.
   */
  recipient?: string;
  /** Show only messages belonging to this blast / campaign batch id. */
  batchId?: string;
  /**
   * Substring search across subject and recipient address. Bounded; results
   * are not cursor-paginated.
   */
  search?: string;
  /** ISO date range start (inclusive). */
  start?: string;
  /** ISO date range end (inclusive). */
  end?: string;
  limit?: number;
  offset?: number;
}

export interface EmailWindowParams {
  /** ISO date range start (inclusive). */
  start?: string;
  /** ISO date range end (inclusive). */
  end?: string;
}

export interface EmailBatchesParams {
  /** ISO date range start (inclusive). */
  start?: string;
  /** ISO date range end (inclusive). */
  end?: string;
  limit?: number;
  offset?: number;
}

export interface EmailSuppressionsParams {
  limit?: number;
  offset?: number;
}

export interface EmailInboxParams {
  /** Filter by processing status: `success` or `error`. Default: all. */
  status?: string;
  /** Substring search across sender address and subject. */
  search?: string;
  /** ISO date range start (inclusive). */
  start?: string;
  /** ISO date range end (inclusive). */
  end?: string;
  /** Cursor from a previous response for pagination. */
  cursor?: string;
  limit?: number;
}

/** Direction of mail flow: `sending` = outbound (SES identity/DKIM); `inbound` = receiving (MX). */
export type DomainDirection = 'sending' | 'inbound';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOMAIN_BASES: Record<DomainDirection, string> = {
  sending: 'outbound-email-domains',
  inbound: 'email-domains',
};

function domainsPath(ctx: AdminContext, direction: DomainDirection): string {
  return `/_internal/v2/apps/${ctx.appId}/settings/${DOMAIN_BASES[direction]}`;
}

async function resolveDomainId(
  ctx: AdminContext,
  direction: DomainDirection,
  domain: string,
): Promise<string> {
  const { domains } = await call<{ domains: EmailDomainBase[] }>(
    ctx,
    'GET',
    domainsPath(ctx, direction),
  );
  const wanted = domain.trim().toLowerCase();
  const match = (domains ?? []).find(
    (d: { domain: string }) => d.domain.toLowerCase() === wanted,
  );
  if (!match) {
    const known = (domains ?? []).map((d: { domain: string }) => d.domain);
    throw new Error(
      `No ${direction} domain "${domain}" on this app.` +
        (known.length ? ` Registered: ${known.join(', ')}` : ''),
    );
  }
  return match.id;
}

// ---------------------------------------------------------------------------
// Outbound message ops
// ---------------------------------------------------------------------------

/**
 * Sent messages for this app, including messages that never reached SES.
 *
 * The log covers every send attempt — suppressed, over-cap,
 * sender-not-allowed — because most real failures never touch the provider.
 * Status values: `suppressed` (app-level unsubscribe), `failed`, `sent`,
 * `delivered`, `blocked` (dropped by an SES suppression list — usually this
 * app's own tenant list after an earlier bounce or spam report from that
 * address), `bounced`, `complained`, `delayed`, `rejected`. Paginated via
 * cursor in the result or by offset.
 *
 * @example
 * const { messages } = await admin.email.list({ status: 'bounced,blocked', limit: 50 });
 */
export function list(ctx: AdminContext, params: EmailListParams = {}) {
  return call<EmailListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/messages${qs(params)}`,
  );
}

/**
 * Full detail for one outbound message, including bounce diagnostics.
 *
 * @throws AdminApiError `not_found` (404) — no message with that id on this app.
 * @example
 * const msg = await admin.email.get('msg_abc123');
 * console.log(msg.status, msg.diagnostic);
 */
export function get(ctx: AdminContext, messageId: string) {
  return call<EmailMessageResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/messages/${seg(messageId)}`,
  );
}

/**
 * Aggregate counts and delivery rates over a time window.
 *
 * `accepted` is the denominator for all rates (messages SES received);
 * `counts` includes pre-SES failures. `series` is a per-bucket time-series
 * for charting.
 *
 * @example
 * const { counts, rates } = await admin.email.stats({ start: '2026-01-01T00:00:00Z' });
 */
export function stats(ctx: AdminContext, params: EmailWindowParams = {}) {
  return call<EmailStatsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/summary${qs(params)}`,
  );
}

/**
 * Whether this app can send email right now, and up to what — the first thing
 * to check when "it's not sending emails".
 *
 * Reports four independent things: `sending` (the gate the send path itself
 * uses, so this and a `409 sending_paused` can never disagree), `enforcement`
 * (the platform's own throttle/pause and WHO applied it), `ses` (Amazon's view
 * of the app's tenant), and `quota` (the daily recipient limit, usage, and
 * where the limit came from).
 *
 * How to read a pause: `sending.source === 'ses'` means Amazon paused the
 * tenant on its own findings — nothing the app owner does lifts it directly;
 * it clears when the finding clears. `source === 'platform'` with
 * `enforcement.origin === 'platform'` is the automatic bounce/complaint sweep
 * and steps down on its own as rates recover; `origin === 'operator'` is a
 * human hold and will not. A throttle shows up as `enforcement.level:
 * 'throttled'` with the reduced `quota.limit` and its `expiresAt`.
 *
 * @example
 * const s = await admin.email.status();
 * if (!s.sending.allowed) console.log(s.sending.source, s.sending.reason);
 * console.log(`${s.quota.used}/${s.quota.limit ?? '∞'} recipients today`);
 */
export function status(ctx: AdminContext) {
  return call<EmailSendingStatusResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/status`,
  );
}

/**
 * One row per blast/campaign with per-status counts and, for queued sends,
 * the in-flight lifecycle.
 *
 * A marketing send delivers one message per recipient; many rows share a
 * `batchId` (set by the caller via `sendEmail`). `recipients` is the total
 * fan-out count including pre-SES failures; `accepted` is the SES-received
 * denominator used for rate calculations.
 *
 * Large or marketing sends are accepted immediately and delivered in chunks —
 * `status` (`accepted`/`sending`/`completed`/`partial`/`failed`), `chunksDone`/
 * `chunksTotal` and `pending` report the progress. `status: null` is a normal,
 * finished send delivered inline (or predating the queue), not an error.
 *
 * @example
 * const { batches } = await admin.email.batches({ limit: 20 });
 * const inFlight = batches.filter((b) => b.status === 'sending');
 */
export function batches(ctx: AdminContext, params: EmailBatchesParams = {}) {
  return call<EmailBatchesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/batches${qs(params)}`,
  );
}

/**
 * Stats for a single blast identified by its batch id, including the queued
 * lifecycle (`status`, chunk progress, `pending`) when the send was queued.
 * A reused batch id reports its NEWEST run's lifecycle.
 *
 * @throws AdminApiError `not_found` (404) — no batch with that id on this app.
 * @example
 * const blast = await admin.email.batch('batch_xyz');
 * console.log(blast.status, blast.pending, blast.counts);
 */
export function batch(ctx: AdminContext, batchId: string) {
  return call<EmailBatchResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/batches/${seg(batchId)}`,
  );
}

/**
 * App-level suppression list (addresses that have opted out of this app's mail).
 *
 * @example
 * const { suppressions } = await admin.email.suppressions({ limit: 100 });
 */
export function suppressions(
  ctx: AdminContext,
  params: EmailSuppressionsParams = {},
) {
  return call<EmailSuppressionsResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/suppressions${qs(params)}`,
  );
}

/**
 * Add an address to this app's suppression list.
 *
 * @throws AdminApiError `invalid_email` (400) — the address is not a valid email.
 * @example
 * await admin.email.suppress('user@example.com');
 */
export function suppress(ctx: AdminContext, email: string) {
  return call<EmailSuppressResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/suppressions/add`,
    { email },
  );
}

/**
 * Remove an address from this app's suppression lists — the app-level
 * unsubscribe row AND the app's SES tenant suppression entry (a prior hard
 * bounce or spam report against this app), which is the one that actually
 * unblocks delivery.
 *
 * No `confirm` parameter here — the op is the deliberate act. The CLI skin
 * keeps the `--confirm` gate before calling this.
 *
 * Read the result, not just `ok`: `tenantEntryRemoved` true means a
 * provider-side bounce record was cleared and mail will be attempted again
 * (another bounce re-suppresses automatically); `platformSuppression` non-null
 * means the address is on SES's ACCOUNT-wide list — never cleared, shared by
 * every app — and this removal changed nothing about deliverability. The CLI
 * skin surfaces both advisories on stderr.
 *
 * @throws AdminApiError `invalid_email` (400) — the address is not a valid email.
 * @example
 * const result = await admin.email.unsuppress('user@example.com');
 * if (result.platformSuppression) console.warn('Still blocked account-wide.');
 */
export function unsuppress(ctx: AdminContext, email: string) {
  return call<EmailUnsuppressResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/outbound-email/suppressions/remove`,
    { email },
  );
}

/**
 * Inbound messages received by this app (sender/subject previews).
 *
 * An inbox row's `id` is its request-log id — open the full detail (parsed
 * message, method run, errors) with `requests.get(id)`. Cursor-paginated;
 * the next page token is in `EmailInboxResult.nextCursor`.
 *
 * @example
 * const { emails } = await admin.email.inbox({ status: 'error', limit: 20 });
 */
export function inbox(ctx: AdminContext, params: EmailInboxParams = {}) {
  return call<EmailInboxResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/inbox${qs(params)}`,
  );
}

// ---------------------------------------------------------------------------
// Domain ops (both directions via DomainDirection)
//
// Generic over the direction so a literal 'sending' / 'inbound' argument gets
// the direction's concrete result type (the sending list carries
// effectiveSender; the inbound one doesn't), while a runtime variable — the
// CLI's spec-key factory passes one — still resolves to the union. The
// implementation casts once: `call` can't know the conditional, but the path
// selection and the conditional select on the same DomainDirection value.
// ---------------------------------------------------------------------------

/**
 * Direction-conditional result selector: maps a literal `DomainDirection` to
 * its concrete result type, or the union when the direction is a runtime variable.
 */
export type ForDirection<D extends DomainDirection, Sending, Inbound> = [
  D,
] extends ['sending']
  ? Sending
  : [D] extends ['inbound']
    ? Inbound
    : Sending | Inbound;

/**
 * All registered custom domains for a direction.
 *
 * Sending domains (`'sending'`) include `effectiveSender` — the address the
 * app currently sends from and its fallback tier (`app_domain` > `org_domain`
 * > `subdomain` > `default`). Inbound domains (`'inbound'`) list custom
 * receiving domains; apps already receive at `*@<slug>.madewithremy.com` with
 * no setup.
 *
 * @example
 * const { domains, effectiveSender } = await admin.email.listDomains('sending');
 */
export function listDomains<D extends DomainDirection>(
  ctx: AdminContext,
  direction: D,
): Promise<
  ForDirection<D, OutboundEmailDomainsListResult, InboundEmailDomainsListResult>
> {
  return call(ctx, 'GET', domainsPath(ctx, direction)) as Promise<
    ForDirection<
      D,
      OutboundEmailDomainsListResult,
      InboundEmailDomainsListResult
    >
  >;
}

/**
 * Pre-flight check: validate a domain name and confirm it is not already registered.
 *
 * For inbound domains, also returns `dnsInstructions` (the MX record) when
 * `valid` is true — the record is known before registration and can be given
 * to the user up front. Sending domain DKIM CNAMEs are only available after
 * `addDomain`. Returns `{ valid: false, errorMessage }` inline rather than
 * throwing for validation failures.
 *
 * @example
 * const { valid, dnsInstructions } = await admin.email.checkDomain('inbound', 'acme.com');
 */
export function checkDomain<D extends DomainDirection>(
  ctx: AdminContext,
  direction: D,
  domain: string,
): Promise<
  ForDirection<D, OutboundEmailDomainCheckResult, InboundEmailDomainCheckResult>
> {
  return call(ctx, 'POST', `${domainsPath(ctx, direction)}/check-domain`, {
    domain,
  }) as Promise<
    ForDirection<
      D,
      OutboundEmailDomainCheckResult,
      InboundEmailDomainCheckResult
    >
  >;
}

/**
 * Register a new custom domain in the given direction.
 *
 * **Sending (`'sending'`):** creates the SES identity and returns
 * `dnsInstructions` containing three DKIM CNAME records (all required) and a
 * recommended SPF TXT record. Hand these to the user to create at their DNS
 * host, then call `verifyDomain` to re-check. SES verification can take
 * minutes after the CNAMEs resolve; `uiStatus` will be `pending` until then.
 *
 * **Inbound (`'inbound'`):** creates the domain row and returns
 * `dnsInstructions` with the single MX record to add. Apps already receive at
 * `*@<slug>.madewithremy.com`; a custom inbound domain is optional.
 *
 * @throws AdminApiError `invalid_domain` (400) — not a valid registrable domain
 *   name; `domain_in_use` (400) — already registered on any app;
 *   `ses_create_failed` (502, sending only) — SES identity creation failed.
 * @example
 * const { domain } = await admin.email.addDomain('sending', 'mail.acme.com');
 * console.log(domain.dnsInstructions.cnameRecords);
 */
export function addDomain<D extends DomainDirection>(
  ctx: AdminContext,
  direction: D,
  domain: string,
): Promise<
  ForDirection<D, OutboundEmailDomainAddResult, InboundEmailDomainAddResult>
> {
  return call(ctx, 'POST', domainsPath(ctx, direction), {
    domain,
  }) as Promise<
    ForDirection<D, OutboundEmailDomainAddResult, InboundEmailDomainAddResult>
  >;
}

/**
 * Force an immediate DNS check on a registered domain.
 *
 * Resolves the domain name to its row id via an extra GET, then calls the
 * `retry` endpoint. Use after adding DNS records to check earlier than the
 * background poller. `uiStatus` transitions from `pending` → `verified`, or
 * stays `action_needed` (check `verificationErrors`). Sending verification
 * that was never started expires after ~72h; fix the records and call
 * `verifyDomain` again.
 *
 * @throws Error if no domain matching `domain` is registered on this app
 *   (thrown before the API call, not an AdminApiError).
 * @throws AdminApiError `not_found` (404) — the row was deleted between list and verify.
 * @example
 * const { domain } = await admin.email.verifyDomain('sending', 'mail.acme.com');
 * console.log(domain.uiStatus, domain.verificationErrors);
 */
export async function verifyDomain<D extends DomainDirection>(
  ctx: AdminContext,
  direction: D,
  domain: string,
): Promise<
  ForDirection<
    D,
    OutboundEmailDomainVerifyResult,
    InboundEmailDomainVerifyResult
  >
> {
  const id = await resolveDomainId(ctx, direction, domain);
  return call(
    ctx,
    'POST',
    `${domainsPath(ctx, direction)}/${seg(id)}/retry`,
  ) as Promise<
    ForDirection<
      D,
      OutboundEmailDomainVerifyResult,
      InboundEmailDomainVerifyResult
    >
  >;
}

/**
 * Remove a registered domain.
 *
 * For sending domains, also tears down the SES identity (best-effort; a SES
 * cleanup failure still removes the row). Resolves the domain name to its row
 * id via an extra GET before deletion.
 *
 * @throws Error if no domain matching `domain` is registered on this app
 *   (thrown before the API call, not an AdminApiError).
 * @throws AdminApiError `not_found` (404) — the row was deleted between list and delete.
 * @example
 * await admin.email.removeDomain('sending', 'mail.acme.com');
 */
export async function removeDomain<D extends DomainDirection>(
  ctx: AdminContext,
  direction: D,
  domain: string,
): Promise<
  ForDirection<
    D,
    OutboundEmailDomainDeleteResult,
    InboundEmailDomainDeleteResult
  >
> {
  const id = await resolveDomainId(ctx, direction, domain);
  return call(
    ctx,
    'POST',
    `${domainsPath(ctx, direction)}/${seg(id)}/delete`,
  ) as Promise<
    ForDirection<
      D,
      OutboundEmailDomainDeleteResult,
      InboundEmailDomainDeleteResult
    >
  >;
}
