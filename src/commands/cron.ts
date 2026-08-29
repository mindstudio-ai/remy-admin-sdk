/**
 * CLI skin for the `cron` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/cron.js (pure, typed); response
 * shapes in ../types/cron.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as cron from '../ops/cron.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

//////////////////////////////////////////////////////////////////////////////
// Scheduled jobs (cron): what's scheduled, how the runs have gone, and a
// manual trigger.
//
// Reads the same `cron/overview` manage endpoint the dashboard uses. A run's
// id doubles as its request-log id, so a failing job's story continues with
// `requests get <runId>` — this group deliberately doesn't duplicate that view.
//////////////////////////////////////////////////////////////////////////////

export const cronSpecs = {
  'cron list': {
    usage: 'Usage: remy-admin cron list [--runs <n>]',
    flags: {
      runs: { type: 'number', min: 1, max: 120 },
    },
  },
  'cron run': {
    usage: 'Usage: remy-admin cron run <route>',
    positionals: [{ name: 'route', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function cronList(ctx: AdminContext, a: Args) {
  out(await cron.list(ctx, { runs: a.num('runs') }));
}

async function cronRun(ctx: AdminContext, a: Args) {
  out(await cron.run(ctx, a.req('route')));
}

export const cronHandlers = {
  'cron list': cronList,
  'cron run': cronRun,
} satisfies Record<keyof typeof cronSpecs, Handler>;

export const cronHelp = `remy-admin cron — Scheduled jobs: schedules, run history, manual trigger.

Subcommands:
  list   Every scheduled job with status and recent runs
  run    Trigger a job now (does not affect its schedule)

Usage:
  remy-admin cron list [--runs <n>]     Recent runs per job (default 15, max 120)
  remy-admin cron run <route>           <route> is the job's method id, as shown by 'cron list'

Notes:
  - Job status: active | paused | blocked (statusReason says why). consecutiveFailures
    counts uninterrupted failures; blocked jobs stop running until fixed and redeployed.
  - A run's id IS its request-log id: follow a failure with 'requests get <runId>'.
  - 'run' returns 202 { requestId, methodId } immediately; the run continues in the
    background. Check the outcome via 'requests get <requestId>'.
  - Errors: cron_job_not_found (route isn't a scheduled method),
    run_already_triggered (a manual run is in flight, or within the 30s debounce).

Examples:
  remy-admin cron list
  remy-admin cron list --runs 50
  remy-admin cron run dailyDigest`;
