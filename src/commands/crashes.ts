/**
 * CLI skin for the `crashes` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/crashes.js (pure, typed); response
 * shapes in ../types/crashes.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { WINDOW, type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as crashes from '../ops/crashes.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const crashesSpecs = {
  'crashes list': {
    usage:
      'Usage: remy-admin crashes list [--release <releaseId>] [--sort recent|frequent] [--limit 50] [--start <ISO date>] [--end <ISO date>]',
    flags: {
      release: { type: 'string' },
      sort: { type: 'string' },
      limit: { type: 'number', min: 0 },
      ...WINDOW,
    },
  },
  'crashes occurrences': {
    usage:
      'Usage: remy-admin crashes occurrences <fingerprint> [--release <releaseId>] [--cursor <token>] [--limit 50] [--start <ISO date>] [--end <ISO date>]',
    positionals: [{ name: 'fingerprint', required: true }],
    flags: {
      release: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'number', min: 0 },
      ...WINDOW,
    },
  },
  'crashes get': {
    usage: 'Usage: remy-admin crashes get <eventId>',
    positionals: [{ name: 'eventId', required: true }],
  },
  'crashes stats': {
    usage:
      'Usage: remy-admin crashes stats [--release <releaseId>] [--start <ISO date>] [--end <ISO date>] [--buckets 24]',
    flags: {
      release: { type: 'string' },
      ...WINDOW,
      buckets: { type: 'number', min: 1 },
    },
  },
} satisfies Record<string, CommandSpec>;

async function crashesList(ctx: AdminContext, a: Args) {
  out(
    await crashes.list(ctx, {
      releaseId: a.str('release'),
      sort: a.str('sort'),
      limit: a.num('limit'),
      start: a.str('start'),
      end: a.str('end'),
    }),
  );
}
async function crashesOccurrences(ctx: AdminContext, a: Args) {
  out(
    await crashes.occurrences(ctx, a.req('fingerprint'), {
      releaseId: a.str('release'),
      cursor: a.str('cursor'),
      limit: a.num('limit'),
      start: a.str('start'),
      end: a.str('end'),
    }),
  );
}
async function crashesGet(ctx: AdminContext, a: Args) {
  out(await crashes.get(ctx, a.req('eventId')));
}
async function crashesStats(ctx: AdminContext, a: Args) {
  out(
    await crashes.stats(ctx, {
      releaseId: a.str('release'),
      start: a.str('start'),
      end: a.str('end'),
      buckets: a.num('buckets'),
    }),
  );
}

export const crashesHandlers = {
  'crashes list': crashesList,
  'crashes occurrences': crashesOccurrences,
  'crashes get': crashesGet,
  'crashes stats': crashesStats,
} satisfies Record<keyof typeof crashesSpecs, Handler>;

export const crashesHelp = `remy-admin crashes — View frontend (browser) crash groups and events.

Crashes are grouped by fingerprint (Sentry-style): drill in via 'occurrences'.

Subcommands:
  list                       List crash groups (one row per fingerprint)
  occurrences <fingerprint>  List individual events for one crash group
  get <eventId>              Get full detail (stack + breadcrumbs) for one event
  stats                      Bucketed time series of total crash volume

Usage:
  remy-admin crashes list [--release <releaseId>] [--sort recent|frequent] [--limit 50] [--start <ISO date>] [--end <ISO date>]
  remy-admin crashes occurrences <fingerprint> [--release <releaseId>] [--cursor <token>] [--limit 50] [--start <ISO date>] [--end <ISO date>]
  remy-admin crashes get <eventId>
  remy-admin crashes stats [--release <releaseId>] [--start <ISO date>] [--end <ISO date>] [--buckets 24]

Examples:
  remy-admin crashes list --sort frequent --limit 10
  remy-admin crashes occurrences abc123fingerprint --limit 25
  remy-admin crashes get evt_xyz789
  remy-admin crashes stats --buckets 24

Notes:
  - 'list' returns groups, not individual events; each row has an exampleEventId
    you can pass to 'get' for a quick drill-in without paging occurrences.
  - 'occurrences' is cursor-paginated (not offset). Pass the returned cursor on
    the next call to fetch the next page.
  - Time-window defaults to the last 7 days when --start/--end are omitted.`;
