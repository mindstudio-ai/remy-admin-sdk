/**
 * CLI skin for the `domains` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/domains.js (pure, typed); response
 * shapes in ../types/domains.js.
 *
 * CLI skin retains: the records/status projection views sliced from
 * `findHostname` entries.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as domains from '../ops/domains.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const domainsSpecs = {
  'domains get': {
    usage: 'Usage: remy-admin domains get',
  },
  'domains set': {
    usage: 'Usage: remy-admin domains set <subdomain>',
    positionals: [{ name: 'subdomain', required: true }],
  },
  'domains check': {
    usage: 'Usage: remy-admin domains check <subdomain>',
    positionals: [{ name: 'subdomain', required: true }],
  },
  'domains custom list': {
    usage: 'Usage: remy-admin domains custom list',
  },
  'domains custom add': {
    usage: 'Usage: remy-admin domains custom add <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
  'domains custom check': {
    usage: 'Usage: remy-admin domains custom check <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
  'domains custom records': {
    usage: 'Usage: remy-admin domains custom records <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
  'domains custom status': {
    usage: 'Usage: remy-admin domains custom status <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
  'domains custom remove': {
    usage: 'Usage: remy-admin domains custom remove <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
  'domains custom retry': {
    usage: 'Usage: remy-admin domains custom retry <hostname>',
    positionals: [{ name: 'hostname', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function domainsGet(ctx: AdminContext) {
  out(await domains.get(ctx));
}
async function domainsSet(ctx: AdminContext, a: Args) {
  out(await domains.set(ctx, a.req('subdomain')));
}
async function domainsCheck(ctx: AdminContext, a: Args) {
  out(await domains.check(ctx, a.req('subdomain')));
}
async function customDomainsList(ctx: AdminContext) {
  out(await domains.customList(ctx));
}
async function customDomainsAdd(ctx: AdminContext, a: Args) {
  out(await domains.customAdd(ctx, a.req('hostname')));
}
async function customDomainsCheck(ctx: AdminContext, a: Args) {
  out(await domains.customCheck(ctx, a.req('hostname')));
}
async function customDomainsRecords(ctx: AdminContext, a: Args) {
  const { entry } = await domains.findHostname(ctx, a.req('hostname'));
  out({
    hostname: entry.hostname,
    isApex: entry.isApex,
    dnsInstructions: entry.dnsInstructions,
  });
}
async function customDomainsStatus(ctx: AdminContext, a: Args) {
  const { entry } = await domains.findHostname(ctx, a.req('hostname'));
  out({
    hostname: entry.hostname,
    uiStatus: entry.uiStatus,
    verificationErrors: entry.verificationErrors ?? null,
    cfStatus: entry.cfStatus,
    cfSslStatus: entry.cfSslStatus,
  });
}
async function customDomainsRemove(ctx: AdminContext, a: Args) {
  out(await domains.customRemove(ctx, a.req('hostname')));
}
async function customDomainsRetry(ctx: AdminContext, a: Args) {
  out(await domains.customRetry(ctx, a.req('hostname')));
}

export const domainsHandlers = {
  'domains get': domainsGet,
  'domains set': domainsSet,
  'domains check': domainsCheck,
  'domains custom list': customDomainsList,
  'domains custom add': customDomainsAdd,
  'domains custom check': customDomainsCheck,
  'domains custom records': customDomainsRecords,
  'domains custom status': customDomainsStatus,
  'domains custom remove': customDomainsRemove,
  'domains custom retry': customDomainsRetry,
} satisfies Record<keyof typeof domainsSpecs, Handler>;

export const domainsHelp = `remy-admin domains — Manage your app's domains.

Platform subdomain (e.g. my-app.madewithremy.com):
  get             Get current custom subdomain
  set             Set a custom subdomain
  check           Check if a subdomain is available

Custom domains (customer-owned hostnames, CNAME/A records):
  custom list                  List all custom hostnames on the app
  custom add <hostname>        Register a custom hostname (apex auto-pairs www)
  custom check <hostname>      Preflight a hostname before registering
  custom records <hostname>    Get the DNS records the customer must add
  custom status <hostname>     Get lifecycle status + any verification errors
  custom remove <hostname>     Remove a hostname (apex also removes paired www)
  custom retry <hostname>      Re-trigger validation (after customer fixes DNS)

Usage:
  remy-admin domains get
  remy-admin domains set my-app
  remy-admin domains check my-app
  remy-admin domains custom list
  remy-admin domains custom add app.acme.com
  remy-admin domains custom add acme.com
  remy-admin domains custom check acme.com
  remy-admin domains custom records app.acme.com
  remy-admin domains custom status app.acme.com
  remy-admin domains custom retry app.acme.com
  remy-admin domains custom remove app.acme.com

Notes:
  - 'add' with an apex (e.g. acme.com) auto-creates the www.apex pair and
    returns both. 'remove' on an apex also removes its paired www.
  - 'list'/'records'/'status' read a CF-synced cache that can be up to ~5
    minutes stale. After the customer adds DNS, use 'retry' to force a
    synchronous re-check.
  - 'uiStatus' values: waiting_for_dns | issuing_ssl | live | action_needed | reconnecting.`;
