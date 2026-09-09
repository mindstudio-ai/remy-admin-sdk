/**
 * CLI skin for the `infra` group: dedicated infrastructure an app leases from
 * the platform. Operations live in ../ops/infra.js; response shapes in
 * ../types/infra.js.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { CliError, EXIT } from '../errors.js';
import * as infra from '../ops/infra.js';
import { out, progress } from '../output.js';
import type { Handler } from '../types.js';
import type { InfraPhase, InfraResource } from '../types/infra.js';

export const infraSpecs = {
  'infra list': {
    usage: 'Usage: remy-admin infra list [--include-destroyed]',
    flags: { 'include-destroyed': { type: 'boolean' } },
  },
  'infra get': {
    usage: 'Usage: remy-admin infra get <id>',
    positionals: [{ name: 'id', required: true }],
  },
  'infra logs': {
    usage: 'Usage: remy-admin infra logs <id> [--follow] [--limit <n>]',
    positionals: [{ name: 'id', required: true }],
    flags: { follow: { type: 'boolean' }, limit: { type: 'string' } },
  },
  'infra provision': {
    usage:
      'Usage: remy-admin infra provision --offering <id> [--name <name>] [--wait] [--timeout <sec>]',
    flags: {
      offering: { type: 'string' },
      name: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['offering'],
      message: '--offering is required (see `infra list` for the catalog).',
    },
  },
  'infra hibernate': {
    usage: 'Usage: remy-admin infra hibernate <id> [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: { wait: { type: 'boolean' }, timeout: { type: 'string' } },
  },
  'infra resume': {
    usage: 'Usage: remy-admin infra resume <id> [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: { wait: { type: 'boolean' }, timeout: { type: 'string' } },
  },
  'infra destroy': {
    usage: 'Usage: remy-admin infra destroy <id> [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: { wait: { type: 'boolean' }, timeout: { type: 'string' } },
  },
  'infra rename': {
    usage: 'Usage: remy-admin infra rename <id> --name <name>',
    positionals: [{ name: 'id', required: true }],
    flags: { name: { type: 'string' } },
    requireAnyOf: { flags: ['name'], message: '--name is required.' },
  },
  'infra resize': {
    usage:
      'Usage: remy-admin infra resize <id> --offering <id> [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: {
      offering: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['offering'],
      message: '--offering is required (see `infra list` for the sizes).',
    },
  },
} satisfies Record<string, CommandSpec>;

/**
 * Block until the resource reaches `phases` (and `until`, when given). Exit
 * codes follow the `releases wait` contract: 1 when the platform reports
 * failure, 2 on timeout.
 */
async function waitAndReport(
  ctx: AdminContext,
  a: Args,
  id: string,
  phases: InfraPhase[],
  summary: Record<string, unknown>,
  until?: (resource: InfraResource) => boolean,
) {
  const timeoutSec = a.str('timeout');
  const result = await infra.waitForPhase(ctx, {
    id,
    phases,
    ...(until ? { until } : {}),
    ...(timeoutSec ? { timeoutMs: Number(timeoutSec) * 1000 } : {}),
    onProgress: progress,
  });
  out({ ...summary, ...result });
  if (result.status === 'failed') {
    throw new CliError(result.error, EXIT.buildFailed);
  }
  if (result.status === 'timeout') {
    throw new CliError(result.error, EXIT.timeout);
  }
}

async function infraList(ctx: AdminContext, a: Args) {
  out(await infra.list(ctx, { includeDestroyed: a.bool('include-destroyed') }));
}

async function infraGet(ctx: AdminContext, a: Args) {
  out(await infra.get(ctx, { id: a.req('id') }));
}

const FOLLOW_POLL_MS = 4000;

/**
 * The platform's narration of a resource. --follow keeps polling and prints
 * each batch of new lines as its own JSON document until interrupted.
 */
async function infraLogs(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const limitRaw = a.str('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  let { logs } = await infra.logs(ctx, { id, ...(limit ? { limit } : {}) });
  out({ logs });
  if (!a.bool('follow')) {
    return;
  }
  let after = logs.length > 0 ? logs[logs.length - 1].id : undefined;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
    ({ logs } = await infra.logs(ctx, {
      id,
      ...(after ? { after } : {}),
      limit: 500,
    }));
    if (logs.length > 0) {
      out({ logs });
      after = logs[logs.length - 1].id;
    }
  }
}

/**
 * What a lease costs, from the price the platform put on the row. Printed with
 * every provision so the commitment is visible in the same output that made it;
 * the platform has already verified a month's credits before accepting.
 */
function pricingOf(resource: InfraResource) {
  const offering = resource.offering;
  if (!offering) {
    return null;
  }
  return {
    offering: offering.id,
    activeMonthlyDollars: offering.monthlyPriceDollars,
    hibernatedMonthlyDollars: offering.hibernatedMonthlyPriceDollars,
    note: "Bills hourly from activation. A month's credits were verified before the lease was accepted.",
  };
}

async function infraProvision(ctx: AdminContext, a: Args) {
  const offeringId = a.str('offering') as string;
  const name = a.str('name');
  const { resource } = await infra.provision(ctx, {
    offeringId,
    ...(name ? { name } : {}),
  });
  const pricing = pricingOf(resource);
  if (!a.bool('wait')) {
    out({
      resource,
      pricing,
      note: 'Provisioning; poll `infra get <id>` or re-run with --wait.',
    });
    return;
  }
  await waitAndReport(ctx, a, resource.id, ['active'], {
    action: 'provision',
    pricing,
  });
}

async function infraHibernate(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const { resource } = await infra.hibernate(ctx, { id });
  if (!a.bool('wait')) {
    out({ resource });
    return;
  }
  await waitAndReport(ctx, a, id, ['hibernated'], { action: 'hibernate' });
}

async function infraResume(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const { resource } = await infra.resume(ctx, { id });
  if (!a.bool('wait')) {
    out({ resource });
    return;
  }
  await waitAndReport(ctx, a, id, ['active'], { action: 'resume' });
}

async function infraDestroy(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const { resource } = await infra.destroy(ctx, { id });
  if (!a.bool('wait')) {
    out({ resource });
    return;
  }
  await waitAndReport(ctx, a, id, ['destroyed'], { action: 'destroy' });
}

async function infraRename(ctx: AdminContext, a: Args) {
  out(
    await infra.rename(ctx, {
      id: a.req('id'),
      name: a.str('name') as string,
    }),
  );
}

/**
 * A resize ends in the phase it started from — active comes back active,
 * hibernated stays hibernated — so the wait is "that phase, once the pending
 * size has cleared", not a new phase.
 */
async function infraResize(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const { resource } = await infra.resize(ctx, {
    id,
    offeringId: a.str('offering') as string,
  });
  const pricing = pricingOf({
    ...resource,
    offering: resource.resizingTo ?? resource.offering,
  });
  if (!a.bool('wait')) {
    out({
      resource,
      pricing,
      note: 'Resizing; searches on its sources pause while it is parked and restored. Poll `infra get <id>` or re-run with --wait.',
    });
    return;
  }
  await waitAndReport(
    ctx,
    a,
    id,
    [resource.phase],
    { action: 'resize', pricing },
    (r) => r.resizingTo === null,
  );
}

export const infraHandlers = {
  'infra list': infraList,
  'infra get': infraGet,
  'infra logs': infraLogs,
  'infra provision': infraProvision,
  'infra hibernate': infraHibernate,
  'infra resume': infraResume,
  'infra destroy': infraDestroy,
  'infra rename': infraRename,
  'infra resize': infraResize,
} satisfies Record<keyof typeof infraSpecs, Handler>;

export const infraHelp = `remy-admin infra — Dedicated infrastructure your app leases from the platform.

Today the one kind is dedicated retrieval: the app's own vector-store capacity
for data sources, isolated from the shared pool. Sizes and prices come from the
platform catalog (\`infra list\` prints them); nothing is priced client-side.

A resource bills by the hour from activation, at the retained-storage rate while
hibernated, and not at all once destroyed. Provisioning (and growing) needs a
month's worth of credits available in the workspace, checked before the request
is accepted; nothing is charged until activation. The provision output prints
the price it committed to. Every action below is audited.

Subcommands:
  list        Resources on this app, plus the offerings you can provision
  get         One resource: billing to date, state timeline, recent log, attached sources
  logs        The platform's log for a resource (--follow to keep reading)
  provision   Lease a new resource (needs a month's credits; prints the price)
  hibernate   Park it: data kept, searches paused, compute charge stops
  resume      Bring a hibernated resource back
  resize      Change its size, data intact (passes through hibernated)
  destroy     Delete it (refused while data sources are placed on it)
  rename      Change the display name

Usage:
  remy-admin infra list [--include-destroyed]
  remy-admin infra get <id>
  remy-admin infra logs <id> [--follow] [--limit <n>]
  remy-admin infra provision --offering <id> [--name <name>] [--wait] [--timeout <sec>]
  remy-admin infra hibernate <id> [--wait] [--timeout <sec>]
  remy-admin infra resume <id> [--wait] [--timeout <sec>]
  remy-admin infra resize <id> --offering <id> [--wait] [--timeout <sec>]
  remy-admin infra destroy <id> [--wait] [--timeout <sec>]
  remy-admin infra rename <id> --name <name>

Placing a data source on a resource:
  remy-admin datasources create --source <slug> --placement <resource-id>
  remy-admin datasources move --source <slug> --to <resource-id|shared> [--wait]

  Start a new corpus on a resource with \`create\`; \`add\` creates a source on
  the shared pool. A populated source moves with \`datasources move\`: its
  stored vectors are copied onto the new capacity in the background (no
  re-embedding), search keeps working from the old placement until the copy
  lands, and adding or removing documents is refused with
  data_source_migrating until it finishes. Moving to \`shared\` is how a source
  leaves a resource you mean to destroy. See \`datasources --help\`.

  Searches on a source whose resource is not active fail with
  capacity_<phase>: capacity_hibernated once parked, capacity_hibernating /
  capacity_resuming while it moves. Once active, a source whose index is being
  rebuilt from durable storage (after a resume, a resize or a lost node)
  answers index_warming with the rebuild's progress and ETA until it lands;
  \`datasources list\` shows it under hydration and the resource under
  progress. The messages are written for the app's end user; the stable code
  is what to act on.

Resizing:
  A resize keeps the documents: the resource is parked, its spec is swapped,
  and it comes back up with its sources' indexes rebuilt from durable storage
  in the background (nothing is re-embedded). Searches on those sources answer
  index_warming until the rebuild lands. A hibernated resource swaps in place
  and stays parked. Growing needs a month's credits at the new rate; shrinking
  is refused below what the resource holds (resize_too_small). \`infra get\`
  shows resizingTo until the swap has happened.

Phases and timing:
  requested → provisioning → active ⇄ hibernated → destroyed, with hibernating /
  resuming / decommissioning in between and failed when a change cannot complete
  (retried automatically; resume or hibernate to retry by hand). A transition
  takes a minute or two; the rebuild that follows a resume runs under its own
  progress with a measured ETA. --wait gives up only after --timeout (default
  600s) WITHOUT movement, so a long rebuild is waited out while it moves.

Billing and the log:
  \`infra get\` reports resource.billing: what the resource has actually been
  charged to date (from the ledger, exact across resizes), the hours at each
  rate, and when it was last billed. Rates are on resource.offering.

  The log is the platform's narration of the resource, not the instance's
  stdout: each step a transition went through ("Waiting for capacity",
  "Rebuilding archive v1 from its artifacts: 14,333,673 document(s)"), each
  failed attempt, and each failure with the
  pod's recent Kubernetes events and the warnings-and-errors tail of the
  instance log at that moment (line.data). \`infra get\` includes the newest
  200 lines; \`infra logs\` pages the rest and, with --follow, prints new lines
  every few seconds as their own JSON document until interrupted.

--wait exit codes: 0 reached the target phase · 1 the platform reported failure ·
2 still transitioning when --timeout elapsed (default 600s).`;
