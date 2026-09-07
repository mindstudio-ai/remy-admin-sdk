/**
 * CLI skin for S3 connectors: `datasources connect|connector|disconnect|sync`.
 * Operations live in ../ops/dataSourceConnectors.js; response shapes in
 * ../types/dataSourceConnectors.js.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as connectors from '../ops/dataSourceConnectors.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';
import { sourceOf, waitAndReport } from './_shared/dataSources.js';

export const dataSourceConnectorsSpecs = {
  'datasources connect': {
    usage:
      'Usage: remy-admin datasources connect --source <slug> --bucket <name> --region <aws-region> [--prefix <p>] [--endpoint <url>] --access-key-secret <NAME> --secret-key-secret <NAME> [--deletions mirror|keep] [--budget-per-sync <dollars>]',
    flags: {
      source: { type: 'string' },
      bucket: { type: 'string' },
      region: { type: 'string' },
      prefix: { type: 'string' },
      endpoint: { type: 'string' },
      'access-key-secret': { type: 'string' },
      'secret-key-secret': { type: 'string' },
      deletions: { type: 'string' },
      'budget-per-sync': { type: 'number', min: 0.01 },
    },
  },
  'datasources connector': {
    usage: 'Usage: remy-admin datasources connector [--source <slug>]',
    flags: { source: { type: 'string' } },
  },
  'datasources disconnect': {
    usage: 'Usage: remy-admin datasources disconnect --source <slug>',
    flags: { source: { type: 'string' } },
  },
  'datasources sync': {
    usage:
      'Usage: remy-admin datasources sync [--source <slug>] [--budget <dollars>] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      budget: { type: 'number', min: 0.01 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
} satisfies Record<string, CommandSpec>;

async function connect(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  if (!slug) {
    fatal('--source is required — a connector is bound to one named source.');
  }
  const bucket = a.str('bucket');
  const region = a.str('region');
  const accessKeyIdSecret = a.str('access-key-secret');
  const secretAccessKeySecret = a.str('secret-key-secret');
  for (const [flag, value] of [
    ['bucket', bucket],
    ['region', region],
    ['access-key-secret', accessKeyIdSecret],
    ['secret-key-secret', secretAccessKeySecret],
  ] as const) {
    if (!value) {
      fatal(`--${flag} is required.`);
    }
  }
  const deletions = a.str('deletions');
  if (deletions && deletions !== 'mirror' && deletions !== 'keep') {
    fatal(`--deletions must be "mirror" or "keep" (got "${deletions}").`);
  }
  const prefix = a.str('prefix');
  const endpoint = a.str('endpoint');
  const budget = a.num('budget-per-sync');

  const { connector } = await connectors.connect(ctx, {
    slug: slug as string,
    bucket: bucket as string,
    region: region as string,
    ...(prefix !== undefined ? { prefix } : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
    accessKeyIdSecret: accessKeyIdSecret as string,
    secretAccessKeySecret: secretAccessKeySecret as string,
    ...(deletions ? { deletions: deletions as 'mirror' | 'keep' } : {}),
    ...(budget !== undefined ? { budgetDollarsPerSync: budget } : {}),
  });
  out({
    dataSource: slug,
    connector,
    note:
      'Connected. Run `datasources sync --source ' +
      slug +
      ' --wait` to load the bucket; the first sync plans first and stops for `datasources jobs approve <id>` when the plan is over the per-sync budget.',
  });
}

async function show(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  out({ dataSource: slug, ...(await connectors.get(ctx, { slug })) });
}

async function disconnect(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  if (!slug) {
    fatal(
      '--source is required — disconnecting never falls back to the default source.',
    );
  }
  const result = await connectors.disconnect(ctx, { slug: slug as string });
  out({
    dataSource: slug,
    ...result,
    note: 'The documents stay. Connect again to follow a bucket; unchanged files are recognised by content and cost nothing to re-sync.',
  });
}

async function sync(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const budget = a.num('budget');
  const { job } = await connectors.sync(ctx, {
    slug,
    ...(budget !== undefined ? { budgetDollars: budget } : {}),
  });
  if (!a.bool('wait')) {
    out({
      dataSource: slug,
      job,
      note: 'Syncing. Poll `datasources jobs status <id>`, or re-run with --wait. A plan over the per-sync budget waits in `planned` for `datasources jobs approve <id>`.',
    });
    return;
  }
  await waitAndReport(ctx, a, job.id, 'job', {
    dataSource: slug,
    action: 'sync',
  });
}

export const dataSourceConnectorsHandlers = {
  'datasources connect': connect,
  'datasources connector': show,
  'datasources disconnect': disconnect,
  'datasources sync': sync,
} satisfies Record<keyof typeof dataSourceConnectorsSpecs, Handler>;

/** Appended to the datasources group help. */
export const dataSourceConnectorsHelp = `
Following an S3 bucket (connectors):
  remy-admin datasources connect --source <slug> --bucket <name> --region <aws-region> [--prefix <p>] --access-key-secret <NAME> --secret-key-secret <NAME> [--deletions mirror|keep] [--budget-per-sync <dollars>]
  remy-admin datasources connector [--source <slug>]
  remy-admin datasources sync [--source <slug>] [--budget <dollars>] [--wait] [--timeout <sec>]
  remy-admin datasources disconnect --source <slug>

  A connector makes a bucket the customer owns the origin of a source. The
  credentials are the NAMES of two app secrets — set them first with
  \`remy-admin secrets set ARCHIVE_S3_KEY --prod <value>\` (or in the dashboard);
  never put a key on a command line or in code. connect checks that both
  secrets exist and that the keys can list the prefix before it records
  anything, and refuses otherwise with the S3 error.

  sync lists the bucket, compares every object's ETag with what was ingested
  before, and runs a job (see above) over what is new or changed: the same
  plan, the same gates, auto-approved under the connector's per-sync budget.
  A plan over the budget — the first backfill of a big bucket — waits in
  \`planned\` for \`jobs approve <id>\`; the nightly deltas run unattended.
  A sync over an unchanged bucket costs nothing. Keys that disappeared from
  the bucket are removed from the source at the end of a full sync under the
  default \`--deletions mirror\`; \`--deletions keep\` leaves them. A changed
  object replaces its document; the old one is kept as lineage.

  Scheduling is the app's: a nightly sync is an ordinary cron interface job
  whose method calls \`Source.sync()\` from the SDK. There is no platform
  schedule to configure.

  On a source without a mapper, objects whose extension no extractor reads
  are skipped, not failed. Re-running connect with the same bucket, region,
  prefix and endpoint updates credentials and policy in place; pointing a
  source at a different bucket needs a disconnect first. disconnect keeps
  every document — only the link and its object index go.
`;
