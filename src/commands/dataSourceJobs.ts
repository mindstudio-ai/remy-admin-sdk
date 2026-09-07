/**
 * CLI skin for `datasources jobs`: bulk ingestion with a plan before spend.
 * Operations live in ../ops/dataSourceJobs.js; response shapes in
 * ../types/dataSourceJobs.js.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type Args, type CommandSpec } from '../args.js';
import { WORKSPACE_DIR } from '../config.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as jobs from '../ops/dataSourceJobs.js';
import { out, progress } from '../output.js';
import type { Handler } from '../types.js';
import type { DataSourceJobSource } from '../types/dataSourceJobs.js';
import { sourceOf, waitAndReport } from './_shared/dataSources.js';

export const dataSourceJobsSpecs = {
  'datasources jobs start': {
    usage:
      'Usage: remy-admin datasources jobs start [--source <slug>] (--store <name> [--access <private|public>] [--prefix <p>] | --manifest <file.jsonl>) [--limit <n>] [--budget <dollars>] [--concurrency <n>] [--approve] [--wait] [--timeout <sec>]',
    flags: {
      source: { type: 'string' },
      store: { type: 'string' },
      access: { type: 'string' },
      prefix: { type: 'string' },
      manifest: { type: 'string' },
      limit: { type: 'number', min: 1 },
      budget: { type: 'number', min: 0.01 },
      concurrency: { type: 'number', min: 1 },
      approve: { type: 'boolean' },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['store', 'manifest'],
      message:
        'Give the job something to read: --store <name> [--prefix <p>], or --manifest <file.jsonl>.',
    },
  },
  'datasources jobs list': {
    usage: 'Usage: remy-admin datasources jobs list [--source <slug>]',
    flags: { source: { type: 'string' } },
  },
  'datasources jobs status': {
    usage:
      'Usage: remy-admin datasources jobs status <id> [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: { wait: { type: 'boolean' }, timeout: { type: 'string' } },
  },
  'datasources jobs approve': {
    usage:
      'Usage: remy-admin datasources jobs approve <id> [--concurrency <n>] [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: {
      concurrency: { type: 'number', min: 1 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
  'datasources jobs pause': {
    usage: 'Usage: remy-admin datasources jobs pause <id>',
    positionals: [{ name: 'id', required: true }],
  },
  'datasources jobs resume': {
    usage:
      'Usage: remy-admin datasources jobs resume <id> [--concurrency <n>] [--wait] [--timeout <sec>]',
    positionals: [{ name: 'id', required: true }],
    flags: {
      concurrency: { type: 'number', min: 1 },
      wait: { type: 'boolean' },
      timeout: { type: 'string' },
    },
  },
  'datasources jobs cancel': {
    usage: 'Usage: remy-admin datasources jobs cancel <id>',
    positionals: [{ name: 'id', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function jobsStart(ctx: AdminContext, a: Args) {
  const slug = sourceOf(a);
  const store = a.str('store');
  const manifest = a.str('manifest');
  if (store && manifest) {
    fatal('Give --store or --manifest, not both.');
  }

  let source: DataSourceJobSource;
  if (manifest) {
    const abs = path.isAbsolute(manifest)
      ? manifest
      : path.join(WORKSPACE_DIR, manifest);
    let content: Buffer;
    try {
      content = fs.readFileSync(abs);
    } catch (err: any) {
      fatal(`Could not read manifest "${manifest}": ${err.message}`);
    }
    progress(`uploading manifest (${(content!.length / 1024).toFixed(0)} KB)…`);
    const { key } = await jobs.uploadManifest(ctx, { slug, content: content! });
    source = { type: 'manifest', key };
  } else {
    const access = a.str('access') ?? 'private';
    if (access !== 'private' && access !== 'public') {
      fatal(`--access must be "private" or "public" (got "${access}").`);
    }
    source = {
      type: 'store',
      store: store as string,
      access: access as 'private' | 'public',
      prefix: a.str('prefix') ?? '',
    };
  }

  const budget = a.num('budget');
  const concurrency = a.num('concurrency');
  const limit = a.num('limit');
  const { job } = await jobs.start(ctx, {
    slug,
    source,
    ...(a.bool('approve') ? { approve: true } : {}),
    ...(budget !== undefined ? { budgetDollars: budget } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });

  if (!a.bool('wait')) {
    out({
      dataSource: slug,
      job,
      note: job.autoApprove
        ? 'Planning, then running once the plan passes the gates. Poll `datasources jobs status <id>` or re-run with --wait.'
        : 'Planning. When the plan is ready, review it with `datasources jobs status <id>` and run `datasources jobs approve <id>`.',
    });
    return;
  }
  // With --approve the wait rides through the run; otherwise it stops at the plan.
  await waitAndReport(ctx, a, job.id, job.autoApprove ? 'job' : 'plan', {
    dataSource: slug,
    action: 'start',
    ...(job.autoApprove
      ? {}
      : { note: 'Review the plan, then `datasources jobs approve <id>`.' }),
  });
}

async function jobsList(ctx: AdminContext, a: Args) {
  const slug = a.str('source');
  out(await jobs.list(ctx, slug ? { slug } : undefined));
}

async function jobsStatus(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  if (!a.bool('wait')) {
    out(await jobs.get(ctx, { id }));
    return;
  }
  await waitAndReport(ctx, a, id, 'job', { action: 'status' });
}

async function jobsApprove(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const concurrency = a.num('concurrency');
  const { job } = await jobs.approve(ctx, {
    id,
    ...(concurrency !== undefined ? { concurrency } : {}),
  });
  if (!a.bool('wait')) {
    out({
      job,
      note: 'Running. Poll `datasources jobs status <id>` or re-run with --wait.',
    });
    return;
  }
  await waitAndReport(ctx, a, id, 'job', { action: 'approve' });
}

async function jobsPause(ctx: AdminContext, a: Args) {
  out(await jobs.pause(ctx, { id: a.req('id') }));
}

async function jobsResume(ctx: AdminContext, a: Args) {
  const id = a.req('id');
  const concurrency = a.num('concurrency');
  const { job } = await jobs.resume(ctx, {
    id,
    ...(concurrency !== undefined ? { concurrency } : {}),
  });
  if (!a.bool('wait')) {
    out({ job });
    return;
  }
  await waitAndReport(ctx, a, id, 'job', { action: 'resume' });
}

async function jobsCancel(ctx: AdminContext, a: Args) {
  out(await jobs.cancel(ctx, { id: a.req('id') }));
}

export const dataSourceJobsHandlers = {
  'datasources jobs start': jobsStart,
  'datasources jobs list': jobsList,
  'datasources jobs status': jobsStatus,
  'datasources jobs approve': jobsApprove,
  'datasources jobs pause': jobsPause,
  'datasources jobs resume': jobsResume,
  'datasources jobs cancel': jobsCancel,
} satisfies Record<keyof typeof dataSourceJobsSpecs, Handler>;

/** Appended to the datasources group help. */
export const dataSourceJobsHelp = `
Bulk ingestion (jobs):
  remy-admin datasources jobs start [--source <slug>] --store <name> [--access <private|public>] [--prefix <p>] [options]
  remy-admin datasources jobs start [--source <slug>] --manifest <file.jsonl> [options]
  remy-admin datasources jobs list [--source <slug>]
  remy-admin datasources jobs status <id> [--wait] [--timeout <sec>]
  remy-admin datasources jobs approve <id> [--wait] [--timeout <sec>]
  remy-admin datasources jobs pause|resume|cancel <id>

  A job loads a whole corpus at once. It reads either every object under a
  prefix of one of the app's file stores (\`files put\` fills one; an app can
  write one at runtime) or a manifest you upload: JSONL, one line per document,
  {"url": "https://…", "filename": "x.pdf", "externalId": "…", "metadata": {…}}.
  filename, externalId and metadata are optional; the URL must be public.

  Nothing is spent until you say so. The platform counts the source, reads a
  sample of about a hundred documents, and writes a plan: documents, chunks,
  cost per stage (embedding, extraction, contextual) at today's rates, storage,
  whether it fits where the source lives, and a duration. \`jobs status\` shows
  it; \`jobs approve\` starts the run. Two gates: the corpus has to fit the
  source's placement (a shared-pool source over the per-source cap answers
  plan_requires_dedicated: place it on dedicated capacity first), and the
  workspace has to be able to cover the projection (insufficient_credits).

  Options on start:
    --approve          Run as soon as the plan passes the gates, no separate approve
    --budget <dollars> Pause when estimated spend reaches this (default 1.5x the plan)
    --concurrency <n>  Batches in flight at once (default 64, max 128)
    --limit <n>        Only the first N objects: a cheap sample of the corpus
    --wait             Block until the plan is ready (or, with --approve, until done)
  On approve and resume:
    --concurrency <n>  Batches in flight from here on (max 128); a plan made at 8 can run at 64

  While running, documents are read in batches of fifty with one embedding
  call per batch. Unchanged documents are skipped by content hash, so re-running
  a job over the same source costs nothing new. Per-document failures are kept
  on the job (\`jobs status\` lists the last twenty) and the run continues; five
  failed batches in a row pause it, as does the budget. \`jobs resume\` continues
  from the checkpoint and retries failed batches; \`jobs cancel\` stops it and
  keeps what was indexed. Search works on the partial corpus throughout.

  One bulk operation per source: a job refuses to start during a move or while
  a candidate version exists, and moves, re-vectorizes and deletes refuse while
  a job is in flight (data_source_busy). Interactive \`add\` keeps working.

  --wait exit codes: 0 done · 1 the job failed, paused, was cancelled, or sits
  in planned because a gate refused it (approve once the cause is fixed) ·
  2 still running when --timeout elapsed (default 3600s).
`;
