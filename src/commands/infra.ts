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
import type { InfraPhase } from '../types/infra.js';

export const infraSpecs = {
  'infra list': {
    usage: 'Usage: remy-admin infra list [--include-destroyed]',
    flags: { 'include-destroyed': { type: 'boolean' } },
  },
  'infra get': {
    usage: 'Usage: remy-admin infra get <id>',
    positionals: [{ name: 'id', required: true }],
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
} satisfies Record<string, CommandSpec>;

/**
 * Block until the resource reaches `phases`. Exit codes follow the `releases
 * wait` contract: 1 when the platform reports failure, 2 on timeout.
 */
async function waitAndReport(
  ctx: AdminContext,
  a: Args,
  id: string,
  phases: InfraPhase[],
  summary: Record<string, unknown>,
) {
  const timeoutSec = a.str('timeout');
  const result = await infra.waitForPhase(ctx, {
    id,
    phases,
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

async function infraProvision(ctx: AdminContext, a: Args) {
  const offeringId = a.str('offering') as string;
  const name = a.str('name');
  const { resource } = await infra.provision(ctx, {
    offeringId,
    ...(name ? { name } : {}),
  });
  if (!a.bool('wait')) {
    out({
      resource,
      note: 'Provisioning; poll `infra get <id>` or re-run with --wait.',
    });
    return;
  }
  await waitAndReport(ctx, a, resource.id, ['active'], { action: 'provision' });
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

export const infraHandlers = {
  'infra list': infraList,
  'infra get': infraGet,
  'infra provision': infraProvision,
  'infra hibernate': infraHibernate,
  'infra resume': infraResume,
  'infra destroy': infraDestroy,
  'infra rename': infraRename,
} satisfies Record<keyof typeof infraSpecs, Handler>;

export const infraHelp = `remy-admin infra — Dedicated infrastructure your app leases from the platform.

Today the one kind is dedicated retrieval: the app's own vector-store capacity
for data sources, isolated from the shared pool. Sizes and prices come from the
platform catalog (\`infra list\` prints them); nothing is priced client-side.

A resource bills by the hour from activation, at the retained-storage rate while
hibernated, and not at all once destroyed. Provisioning requires the workspace to
cover one month up front. Every action below is audited.

Subcommands:
  list        Resources on this app, plus the offerings you can provision
  get         One resource with its state timeline and attached sources
  provision   Lease a new resource (spends credits)
  hibernate   Park it: data kept, searches paused, compute charge stops
  resume      Bring a hibernated resource back
  destroy     Delete it (refused while data sources are placed on it)
  rename      Change the display name

Usage:
  remy-admin infra list [--include-destroyed]
  remy-admin infra get <id>
  remy-admin infra provision --offering <id> [--name <name>] [--wait] [--timeout <sec>]
  remy-admin infra hibernate <id> [--wait] [--timeout <sec>]
  remy-admin infra resume <id> [--wait] [--timeout <sec>]
  remy-admin infra destroy <id> [--wait] [--timeout <sec>]
  remy-admin infra rename <id> --name <name>

Placing a data source on a resource:
  remy-admin datasources config --source <slug> --placement <resource-id>
  remy-admin datasources config --source <slug> --placement shared

  Placement can only change while the source has no built documents; moving a
  populated source is a re-vectorization onto the new capacity, which is not
  available yet. Searches on a source whose resource is hibernated return
  capacity_hibernated until it resumes.

Phases:
  requested → provisioning → active ⇄ hibernated → destroyed, with hibernating /
  resuming / decommissioning in between and failed when a change cannot complete
  (retried automatically; resume or hibernate to retry by hand).

--wait exit codes: 0 reached the target phase · 1 the platform reported failure ·
2 still transitioning when --timeout elapsed (default 600s).`;
