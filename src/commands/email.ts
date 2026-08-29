/**
 * CLI skin for the `email` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/email.js (pure, typed); response
 * shapes in ../types/email.js.
 *
 * CLI skin retains: the `--confirm` gate on unsuppress plus its stderr
 * advisory, and the factory binding both domain directions to spec keys.
 */

import { PAGINATION, WINDOW, type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as email from '../ops/email.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

//////////////////////////////////////////////////////////////////////////////
// Outbound email: the delivery log, blast stats, and the app's unsubscribe list.
//
// Reads the same `outbound-email/*` manage endpoints the dashboard uses, so
// anything answerable in the console is answerable here. That parity is the
// point — an app owner (or the agent debugging on their behalf) should never have
// to open our UI to find out why a send didn't arrive.
//
// The log deliberately covers mail that never reached SES — unsubscribed, over
// the daily cap, sender not allowed — because that is where most real failures
// live, and a log built on delivery events alone shows nothing at all for them.
//////////////////////////////////////////////////////////////////////////////

export const emailSpecs = {
  'email list': {
    usage:
      'Usage: remy-admin email list [--status <s,s>] [--kind method|auth] [--recipient <addr>] [--batch <id>] [--search <text>] [--start <ISO>] [--end <ISO>] [--limit 50]',
    flags: {
      status: { type: 'string' },
      kind: { type: 'string' },
      recipient: { type: 'string' },
      batch: { type: 'string' },
      search: { type: 'string' },
      ...WINDOW,
      ...PAGINATION,
    },
  },
  'email get': {
    usage: 'Usage: remy-admin email get <messageId>',
    positionals: [{ name: 'messageId', required: true }],
  },
  'email stats': {
    usage:
      'Usage: remy-admin email stats [--start <ISO date>] [--end <ISO date>]',
    flags: { ...WINDOW },
  },
  'email batches': {
    usage:
      'Usage: remy-admin email batches [--start <ISO date>] [--end <ISO date>] [--limit 50]',
    flags: { ...WINDOW, ...PAGINATION },
  },
  'email batch': {
    usage: 'Usage: remy-admin email batch <batchId>',
    positionals: [{ name: 'batchId', required: true }],
  },
  'email suppressions': {
    usage: 'Usage: remy-admin email suppressions [--limit 50]',
    flags: { ...PAGINATION },
  },
  'email suppress': {
    usage: 'Usage: remy-admin email suppress <email>',
    positionals: [{ name: 'email', required: true }],
  },
  'email unsuppress': {
    usage: 'Usage: remy-admin email unsuppress <email> --confirm',
    positionals: [{ name: 'email', required: true }],
    flags: { confirm: { type: 'boolean' } },
  },
  'email inbox': {
    usage:
      'Usage: remy-admin email inbox [--status success|error] [--search <text>] [--start <ISO>] [--end <ISO>] [--cursor <c>] [--limit 50]',
    flags: {
      status: { type: 'string' },
      search: { type: 'string' },
      ...WINDOW,
      cursor: { type: 'string' },
      limit: { type: 'number', min: 1 },
    },
  },
  'email domains list': {
    usage: 'Usage: remy-admin email domains list',
  },
  'email domains check': {
    usage: 'Usage: remy-admin email domains check <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email domains add': {
    usage: 'Usage: remy-admin email domains add <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email domains verify': {
    usage: 'Usage: remy-admin email domains verify <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email domains remove': {
    usage: 'Usage: remy-admin email domains remove <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email inbound-domains list': {
    usage: 'Usage: remy-admin email inbound-domains list',
  },
  'email inbound-domains check': {
    usage: 'Usage: remy-admin email inbound-domains check <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email inbound-domains add': {
    usage: 'Usage: remy-admin email inbound-domains add <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email inbound-domains verify': {
    usage: 'Usage: remy-admin email inbound-domains verify <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
  'email inbound-domains remove': {
    usage: 'Usage: remy-admin email inbound-domains remove <domain>',
    positionals: [{ name: 'domain', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function emailList(ctx: AdminContext, a: Args) {
  out(
    await email.list(ctx, {
      status: a.str('status'),
      kind: a.str('kind'),
      recipient: a.str('recipient'),
      batchId: a.str('batch'),
      search: a.str('search'),
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
      offset: a.num('offset'),
    }),
  );
}

async function emailGet(ctx: AdminContext, a: Args) {
  out(await email.get(ctx, a.req('messageId')));
}

async function emailStats(ctx: AdminContext, a: Args) {
  out(await email.stats(ctx, { start: a.str('start'), end: a.str('end') }));
}

async function emailBatches(ctx: AdminContext, a: Args) {
  out(
    await email.batches(ctx, {
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
      offset: a.num('offset'),
    }),
  );
}

async function emailBatch(ctx: AdminContext, a: Args) {
  out(await email.batch(ctx, a.req('batchId')));
}

async function emailSuppressions(ctx: AdminContext, a: Args) {
  out(
    await email.suppressions(ctx, {
      limit: a.num('limit'),
      offset: a.num('offset'),
    }),
  );
}

async function emailSuppress(ctx: AdminContext, a: Args) {
  out(await email.suppress(ctx, a.req('email')));
}

/**
 * Resubscribe an address.
 *
 * `--confirm` is required because this is outward-facing: it causes mail to reach
 * someone who opted out. A single-address resubscribe is a legitimate, common
 * request (someone emailed support asking to be re-added) — the gate exists
 * because the agent runs this command too, and an automated opt-out reversal
 * should be a deliberate act rather than a side effect.
 *
 * The response carries `platformSuppression`. Non-null means the address is ALSO
 * on SES's account-level list after a hard bounce or complaint, which we never
 * clear (that list is account-wide, so re-sending spends sending reputation
 * shared by every tenant). Removing our row does not make that address
 * deliverable, so say so rather than printing a bare success.
 */
async function emailUnsuppress(ctx: AdminContext, a: Args) {
  if (!a.bool('confirm')) {
    fatal(
      'Refusing without --confirm: resubscribing sends mail to someone who opted out.',
    );
  }
  const result = await email.unsuppress(ctx, a.req('email'));
  out(result);
  if (result?.platformSuppression) {
    const { reason, at } = result.platformSuppression;
    console.error(
      `\nNote: removed from this app's list, but ${a.req('email')} is still on the ` +
        `platform suppression list (${reason}${at ? ` since ${at}` : ''}). ` +
        `Mail to it will still be blocked — that list is account-wide and is not cleared.`,
    );
  }
}

async function emailInbox(ctx: AdminContext, a: Args) {
  out(
    await email.inbox(ctx, {
      status: a.str('status'),
      search: a.str('search'),
      start: a.str('start'),
      end: a.str('end'),
      cursor: a.str('cursor'),
      limit: a.num('limit'),
    }),
  );
}

//////////////////////////////////////////////////////////////////////////////
// Custom email domains, both directions:
//   sending  → settings/outbound-email-domains (SES identity; DKIM CNAMEs)
//   inbound  → settings/email-domains          (MX pointing at the platform)
//
// The API keys mutations by row id, but the caller knows the domain name —
// so verify/remove take the name and resolve it via the list. The one extra
// GET buys the same ergonomics as `domains custom remove <hostname>`.
//////////////////////////////////////////////////////////////////////////////

const domainCommands = (direction: email.DomainDirection) => ({
  list: async (ctx: AdminContext) => {
    out(await email.listDomains(ctx, direction));
  },
  check: async (ctx: AdminContext, a: Args) => {
    out(await email.checkDomain(ctx, direction, a.req('domain')));
  },
  add: async (ctx: AdminContext, a: Args) => {
    out(await email.addDomain(ctx, direction, a.req('domain')));
  },
  verify: async (ctx: AdminContext, a: Args) => {
    out(await email.verifyDomain(ctx, direction, a.req('domain')));
  },
  remove: async (ctx: AdminContext, a: Args) => {
    out(await email.removeDomain(ctx, direction, a.req('domain')));
  },
});

const sendingDomains = domainCommands('sending');
const inboundDomains = domainCommands('inbound');

export const emailHandlers = {
  'email list': emailList,
  'email get': emailGet,
  'email stats': emailStats,
  'email batches': emailBatches,
  'email batch': emailBatch,
  'email suppressions': emailSuppressions,
  'email suppress': emailSuppress,
  'email unsuppress': emailUnsuppress,
  'email inbox': emailInbox,
  'email domains list': sendingDomains.list,
  'email domains check': sendingDomains.check,
  'email domains add': sendingDomains.add,
  'email domains verify': sendingDomains.verify,
  'email domains remove': sendingDomains.remove,
  'email inbound-domains list': inboundDomains.list,
  'email inbound-domains check': inboundDomains.check,
  'email inbound-domains add': inboundDomains.add,
  'email inbound-domains verify': inboundDomains.verify,
  'email inbound-domains remove': inboundDomains.remove,
} satisfies Record<keyof typeof emailSpecs, Handler>;

export const emailHelp = `remy-admin email — Email: delivery log, blast stats, unsubscribes, inbox, custom domains.

Subcommands:
  list           List sent messages (includes mail that never reached the provider)
  get            Full detail for one message, including bounce diagnostics
  stats          Counts and rates over a window
  batches        One row per blast, with per-status counts
  batch          Stats for a single blast
  suppressions   This app's unsubscribe list
  suppress       Add an address to the unsubscribe list
  unsuppress     Remove an address (requires --confirm)
  inbox          Inbound messages received by the app (sender/subject previews)

  domains list|check|add|verify|remove <domain>           Custom SENDING domains
  inbound-domains list|check|add|verify|remove <domain>   Custom RECEIVING domains

Notes:
  Statuses: suppressed, failed, sent, delivered, blocked, bounced, complained,
  delayed, rejected. "blocked" means the platform-wide suppression list dropped
  it — usually another tenant's hard bounce — not that this address is bad.

  --recipient is an exact match and is index-backed; use --search for partials
  (bounded, and not paginated).

  A marketing send delivers one message per recipient, so a campaign is many
  rows sharing a batch id. Pass batchId to sendEmail to group them under your own
  campaign id.

  An inbox row's id is its request-log id: open the full detail (parsed message,
  method run, errors) with 'requests get <id>'.

Custom domains — two independent directions:
  'domains'          govern the From address (SES identity). 'add' returns
                     dnsInstructions: three DKIM CNAME records (required) and a
                     recommended SPF TXT — hand these to the user to create at
                     their DNS host, then 'verify <domain>' to re-check now.
                     'list' also returns effectiveSender: what the app currently
                     sends as, and which tier that address comes from.
  'inbound-domains'  receive mail at the user's own domain via one MX record
                     ('check' returns it up front — no registration needed to
                     see it). Apps already receive at *@<slug>.madewithremy.com
                     with no setup; a custom inbound domain is optional polish.

  uiStatus per domain: pending (records not confirmed yet — sending verification
  can take minutes after the CNAMEs resolve), verified, or action_needed (check
  verificationErrors; sending verification expires unstarted after ~72h — fix
  the records and 'verify' again).

Examples:
  remy-admin email domains add mail.acme.com
  remy-admin email domains verify mail.acme.com
  remy-admin email inbound-domains check acme.com
  remy-admin email inbox --status error --limit 20
`;
