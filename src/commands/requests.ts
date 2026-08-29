/**
 * CLI skin for the `requests` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/requests.js (pure, typed); response
 * shapes in ../types/requests.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { PAGINATION, WINDOW, type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as requests from '../ops/requests.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const requestsSpecs = {
  'requests list': {
    usage:
      'Usage: remy-admin requests list [--method <methodId>] [--status success|error] [--limit 50] [--offset 0]',
    flags: {
      method: { type: 'string' },
      status: { type: 'string' },
      ...PAGINATION,
    },
  },
  'requests get': {
    usage: 'Usage: remy-admin requests get <requestId>',
    positionals: [{ name: 'requestId', required: true }],
  },
  'requests stats': {
    // `--method` selects a different endpoint here, so it is not a query param.
    usage:
      'Usage: remy-admin requests stats [--method <methodId>] [--start <ISO date>] [--end <ISO date>]',
    flags: { method: { type: 'string' }, ...WINDOW },
  },
} satisfies Record<string, CommandSpec>;

async function requestsList(ctx: AdminContext, a: Args) {
  out(
    await requests.list(ctx, {
      methodId: a.str('method'),
      status: a.str('status'),
      limit: a.num('limit'),
      offset: a.num('offset'),
    }),
  );
}
async function requestsGet(ctx: AdminContext, a: Args) {
  out(await requests.get(ctx, a.req('requestId')));
}
async function requestsStats(ctx: AdminContext, a: Args) {
  const window = { start: a.str('start'), end: a.str('end') };
  const method = a.str('method');
  if (method) {
    out(await requests.statsForMethod(ctx, method, window));
  } else {
    out(await requests.statsSummary(ctx, window));
  }
}

export const requestsHandlers = {
  'requests list': requestsList,
  'requests get': requestsGet,
  'requests stats': requestsStats,
} satisfies Record<keyof typeof requestsSpecs, Handler>;

export const requestsHelp = `remy-admin requests — View request logs and metrics.

Subcommands:
  list    List recent requests
  get     Get full details of a specific request
  stats   View aggregated metrics

Usage:
  remy-admin requests list [--method <methodId>] [--status success|error] [--limit 50] [--offset 0]
  remy-admin requests get <requestId>
  remy-admin requests stats [--method <methodId>] [--start <ISO date>] [--end <ISO date>]

Examples:
  remy-admin requests list --limit 10
  remy-admin requests list --method mth_abc123 --status error
  remy-admin requests get req_abc123
  remy-admin requests stats
  remy-admin requests stats --method mth_abc123`;
