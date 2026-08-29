/**
 * CLI skin for the `jewels` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/jewels.js (pure, typed); response
 * shapes in ../types/jewels.js.
 *
 * CLI skin retains: the train --wait poll with status/loss printing,
 * compactRunLog's display projection, and the NDJSON export passthrough
 * (cliStream).
 */

import { WINDOW, type Args, type CommandSpec } from '../args.js';
import { rawToStdout } from '../cliStream.js';
import type { AdminContext } from '../ctx.js';
import { qs } from '../http.js';
import { fatal } from '../errors.js';
import * as jewels from '../ops/jewels.js';
import { JEWEL_RUN_TIMEOUT_MS } from '../ops/jewels.js';
import { out } from '../output.js';
import { sleep } from '../sleep.js';
import type { Handler } from '../types.js';
import type { TrainingLogEntry, TrainingRunRow } from '../types/jewels.js';

export const jewelsSpecs = {
  'jewels overview': {
    usage:
      'Usage: remy-admin jewels overview [--start <ISO date>] [--end <ISO date>]',
    flags: { ...WINDOW },
  },
  'jewels pairs': {
    usage:
      'Usage: remy-admin jewels pairs [--method-id <id>] [--verdict agree|disagree|skip|expired] [--mode shadow|arrival|auto|approve] [--limit 50] [--cursor <token>] [--start <ISO date>] [--end <ISO date>]',
    flags: {
      'method-id': { type: 'string' },
      verdict: { type: 'string' },
      mode: { type: 'string' },
      limit: { type: 'number', min: 0 },
      cursor: { type: 'string' },
      ...WINDOW,
    },
  },
  'jewels pair': {
    usage: 'Usage: remy-admin jewels pair <pairId>',
    positionals: [{ name: 'pairId', required: true }],
  },
  'jewels queue': {
    usage: 'Usage: remy-admin jewels queue [--method-id <id>] [--limit 50]',
    flags: {
      'method-id': { type: 'string' },
      limit: { type: 'number', min: 0 },
    },
  },
  'jewels timeseries': {
    usage:
      'Usage: remy-admin jewels timeseries [--method-id <id>] [--start <ISO date>] [--end <ISO date>] [--buckets 24]',
    flags: {
      'method-id': { type: 'string' },
      ...WINDOW,
      buckets: { type: 'number', min: 1 },
    },
  },
  'jewels resolve': {
    usage:
      "Usage: remy-admin jewels resolve <itemId> (--approve [--input '<json>'] | --dismiss)",
    positionals: [{ name: 'itemId', required: true }],
    flags: {
      approve: { type: 'boolean' },
      dismiss: { type: 'boolean' },
      input: { type: 'string' },
    },
  },
  'jewels dryrun': {
    usage: "Usage: remy-admin jewels dryrun <methodId> --subject '<json>'",
    positionals: [{ name: 'methodId', required: true }],
    flags: {
      subject: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['subject'],
      message: '--subject is required.',
    },
  },
  'jewels export': {
    usage:
      'Usage: remy-admin jewels export <methodId> [--file sft-train|sft-eval|preference|eval-disagreements] [--start <ISO date>] [--end <ISO date>]',
    positionals: [{ name: 'methodId', required: true }],
    flags: {
      file: { type: 'string' },
      ...WINDOW,
    },
  },
  'jewels train': {
    usage:
      'Usage: remy-admin jewels train <methodId> [--wait]\n' +
      'Returns immediately with a run id + dataset report; poll with ' +
      "'jewels run <runId>' (live progress on the row). --wait blocks " +
      'until terminal (minutes to tens of minutes) — for humans at a ' +
      'terminal, not agents.',
    positionals: [{ name: 'methodId', required: true }],
    flags: {
      wait: { type: 'boolean' },
    },
  },
  'jewels runs': {
    usage: 'Usage: remy-admin jewels runs [--method-id <id>] [--limit 20]',
    flags: {
      'method-id': { type: 'string' },
      limit: { type: 'number', min: 0 },
    },
  },
  'jewels run': {
    usage: 'Usage: remy-admin jewels run <runId>',
    positionals: [{ name: 'runId', required: true }],
  },
  'jewels grade': {
    usage:
      'Usage: remy-admin jewels grade <runId>\n' +
      "Re-grades a completed run's held-out predictions with the jewel's " +
      'own grade function (the same grader as the pairs dashboard) and ' +
      'writes report.grading. Runs automatically on completion; this is ' +
      'the manual retry/backfill. Idempotent.',
    positionals: [{ name: 'runId', required: true }],
  },
} satisfies Record<string, CommandSpec>;

function parseJsonFlag(a: Args, flag: string): Record<string, unknown> {
  const raw = a.str(flag)!;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fatal(`Invalid JSON for --${flag}: ${raw}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fatal(`--${flag} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function jewelsOverview(ctx: AdminContext, a: Args) {
  out(
    await jewels.overview(ctx, {
      start: a.str('start'),
      end: a.str('end'),
    }),
  );
}
async function jewelsPairs(ctx: AdminContext, a: Args) {
  out(
    await jewels.pairs(ctx, {
      methodId: a.str('method-id'),
      verdict: a.str('verdict'),
      mode: a.str('mode'),
      limit: a.num('limit'),
      cursor: a.str('cursor'),
      start: a.str('start'),
      end: a.str('end'),
    }),
  );
}
async function jewelsPair(ctx: AdminContext, a: Args) {
  out(await jewels.pair(ctx, a.req('pairId')));
}
async function jewelsQueue(ctx: AdminContext, a: Args) {
  out(
    await jewels.queue(ctx, {
      methodId: a.str('method-id'),
      limit: a.num('limit'),
    }),
  );
}
async function jewelsTimeseries(ctx: AdminContext, a: Args) {
  out(
    await jewels.timeseries(ctx, {
      methodId: a.str('method-id'),
      start: a.str('start'),
      end: a.str('end'),
      buckets: a.num('buckets'),
    }),
  );
}
async function jewelsResolve(ctx: AdminContext, a: Args) {
  const approve = a.bool('approve');
  const dismiss = a.bool('dismiss');
  if (approve === dismiss) {
    fatal('Pass exactly one of --approve or --dismiss.');
  }
  if (dismiss && a.str('input') !== undefined) {
    fatal('--input only applies to --approve.');
  }
  const params: jewels.JewelsResolveParams = {
    itemId: a.req('itemId'),
    action: approve ? 'approve' : 'dismiss',
  };
  if (a.str('input') !== undefined) {
    params.input = parseJsonFlag(a, 'input');
  }
  out(await jewels.resolve(ctx, params));
}
async function jewelsExport(ctx: AdminContext, a: Args) {
  const apiPath = `/_internal/v2/apps/${ctx.appId}/jewels/export${qs({
    file: a.str('file'),
    start: a.str('start'),
    end: a.str('end'),
    methodId: a.req('methodId'),
  })}`;
  if (a.str('file')) {
    // Raw JSONL passthrough: each dataset row goes to stdout as its own line.
    await rawToStdout(ctx, 'GET', apiPath, JEWEL_RUN_TIMEOUT_MS);
    return;
  }
  out(
    await jewels.exportSummary(ctx, {
      methodId: a.req('methodId'),
      start: a.str('start'),
      end: a.str('end'),
    }),
  );
}

async function jewelsDryrun(ctx: AdminContext, a: Args) {
  out(
    await jewels.dryrun(ctx, {
      methodId: a.req('methodId'),
      subject: parseJsonFlag(a, 'subject'),
    }),
  );
}

const TRAIN_POLL_MS = 15_000;
const TRAIN_WAIT_LIMIT_MS = 45 * 60_000;

async function jewelsTrain(ctx: AdminContext, a: Args) {
  const started = await jewels.train(ctx, { methodId: a.req('methodId') });
  if (!a.bool('wait')) {
    out(started);
    return;
  }
  // Dataset report first so the wait has context, then poll to terminal.
  out({ runId: started.run?.id, summary: started.summary });
  const runId = started.run?.id;
  const deadline = Date.now() + TRAIN_WAIT_LIMIT_MS;
  // Streaming feel from a poll: the run carries an append-only event log
  // (status narration + loss points); print only what's new each poll,
  // cursored by log length.
  let lastLogLen = 0;
  while (Date.now() < deadline) {
    await sleep(TRAIN_POLL_MS);
    const { run } = await jewels.getRun(ctx, runId);
    const log: TrainingLogEntry[] = Array.isArray(run.log) ? run.log : [];
    const fresh = log.slice(lastLogLen);
    lastLogLen = log.length;
    const isStatus = (
      x: TrainingLogEntry,
    ): x is Extract<TrainingLogEntry, { kind: 'status' }> =>
      x?.kind === 'status';
    const isLoss = (
      x: TrainingLogEntry,
    ): x is Extract<TrainingLogEntry, { kind: 'loss' }> => x?.kind === 'loss';
    for (const e of fresh.filter(isStatus)) {
      out({ status: run.status, at: e.ts, message: e.message });
    }
    const losses = fresh.filter(isLoss);
    if (losses.length) {
      const last = losses[losses.length - 1];
      const p = run.progress;
      out({
        status: run.status,
        step: `${last.step}/${p?.totalSteps ?? '?'}`,
        loss: last.loss,
      });
    }
    if (run.status === 'complete' || run.status === 'failed') {
      out(compactRunLog(run));
      if (run.status === 'failed') {
        process.exitCode = 1;
      }
      return;
    }
  }
  fatal(
    `Timed out waiting for run ${runId} (still in flight; check 'jewels run ${runId}').`,
  );
}

// The event log's loss points are chart data, not terminal reading — compact
// them to a count and keep the human-readable status narration. Candidate
// checkpoints' prediction arrays get the same treatment (their grading
// summaries stay; the full rows live in the report on S3 and the dashboard).
function compactRunLog(run: TrainingRunRow) {
  // The projection intentionally reshapes fields, so the result is not a
  // TrainingRunRow; report internals are dynamic per the DAO (Record<string, any>).
  let out: Record<string, unknown> = { ...run };
  if (Array.isArray(run.log)) {
    const statusEntries = run.log.filter((e) => e?.kind === 'status');
    const lossPoints = run.log.length - statusEntries.length;
    out = { ...out, log: { statusEntries, lossPoints } };
  }
  if (Array.isArray(run.report?.candidates)) {
    out = {
      ...out,
      report: {
        ...run.report,
        candidates: run.report.candidates.map((c: Record<string, unknown>) =>
          Array.isArray(c?.predictions)
            ? { ...c, predictions: c.predictions.length }
            : c,
        ),
      },
    };
  }
  return out;
}

async function jewelsRuns(ctx: AdminContext, a: Args) {
  out(
    await jewels.runs(ctx, {
      methodId: a.str('method-id'),
      limit: a.num('limit'),
    }),
  );
}

async function jewelsRunGet(ctx: AdminContext, a: Args) {
  const { run } = await jewels.getRun(ctx, a.req('runId'));
  out({ run: compactRunLog(run) });
}

async function jewelsGrade(ctx: AdminContext, a: Args) {
  out(await jewels.grade(ctx, a.req('runId')));
}

export const jewelsHandlers = {
  'jewels overview': jewelsOverview,
  'jewels pairs': jewelsPairs,
  'jewels pair': jewelsPair,
  'jewels queue': jewelsQueue,
  'jewels timeseries': jewelsTimeseries,
  'jewels resolve': jewelsResolve,
  'jewels dryrun': jewelsDryrun,
  'jewels export': jewelsExport,
  'jewels train': jewelsTrain,
  'jewels runs': jewelsRuns,
  'jewels run': jewelsRunGet,
  'jewels grade': jewelsGrade,
} satisfies Record<keyof typeof jewelsSpecs, Handler>;

export const jewelsHelp = `remy-admin jewels — Monitor jewel shadowing; review + approve the proposal queue.

A jewel is a method's agentic shadow companion: it proposes the same decision
a human makes, and each (human action, jewel proposal) is graded into a PAIR
with a verdict — agree, disagree, skip (the jewel abstained on a moment the
human acted on), or expired (proposed, but nobody acted within the attribution
window). Methods with autonomy 'approve' queue their proposals for a human
reviewer instead of committing.

Subcommands:
  overview     Per-method rollup: autonomy, sampleRate, pair counts by verdict,
               agreement rate, human-invocation coverage, queue depth
  pairs        List pairs (slim rows; cursor-paginated)
  pair <id>    Full pair record: proposed vs actual, reasoning, grade notes,
               plus hydrated model transcripts when the jewel attached traces
  queue        Pending approve-mode proposals awaiting review
  timeseries   Verdict counts over time (agreement trend)
  resolve      Approve or dismiss one queue item AS the calling user
  dryrun       Run the LIVE jewel against a subject; report what it would
               propose without recording or committing anything
  export       The pair ledger as training data: a dataset report (counts,
               exclusions, trace coverage), or one file streamed as JSONL
  train        Train a private model on the method's graded pairs: exports the
               dataset, runs LoRA fine-tuning on platform GPUs, returns an
               adapter + a held-out agreement report
  runs         List training runs; run <id> shows one run + its report
  grade <id>   Re-grade a run's predictions with the jewel's own grader

The latest complete run per method is auto-served on the platform's GPU pool
as an ordinary model id (tuned/{appId}/{methodId}) — test it with a normal
generate-text call, not a jewels subcommand.

Usage:
  remy-admin jewels overview [--start <ISO date>] [--end <ISO date>]
  remy-admin jewels pairs [--method-id <id>] [--verdict agree|disagree|skip|expired] [--mode shadow|arrival|auto|approve] [--limit 50] [--cursor <token>]
  remy-admin jewels pair <pairId>
  remy-admin jewels queue [--method-id <id>] [--limit 50]
  remy-admin jewels timeseries [--method-id <id>] [--buckets 24]
  remy-admin jewels resolve <itemId> (--approve [--input '<json>'] | --dismiss)
  remy-admin jewels dryrun <methodId> --subject '<json>'
  remy-admin jewels export <methodId> [--file sft-train|sft-eval|preference|eval-disagreements]
  remy-admin jewels train <methodId> [--wait]
  remy-admin jewels runs [--method-id <id>]
  remy-admin jewels run <runId>

Examples:
  remy-admin jewels overview
  remy-admin jewels pairs --method-id triage-issue --verdict disagree
  remy-admin jewels pair 6f1e...
  remy-admin jewels queue
  remy-admin jewels resolve 6f1e... --approve
  remy-admin jewels resolve 6f1e... --approve --input '{"issueId":"abc","severity":"high"}'
  remy-admin jewels resolve 6f1e... --dismiss
  remy-admin jewels dryrun triage-issue --subject '{"issueId":"abc"}'
  remy-admin jewels export triage-issue
  remy-admin jewels export triage-issue --file sft-train > train.jsonl
  remy-admin jewels train triage-issue --wait
  remy-admin jewels run 6f1e...

Notes:
  - 'resolve --approve' APPLIES the method as you (the reviewer): the proposal's
    input runs for real, the platform grades proposed-vs-final, and the item
    closes. Pass --input to apply an edited version (recorded as resolution
    'edited'). --dismiss closes the item without acting.
  - 'dryrun' runs against production data inside a disposable database mirror,
    so it is guaranteed side-effect-free on the app database. It is the prod
    twin of the dev testJewel tool (which runs draft code against the dev DB).
  - approve/dryrun hold the request for a full jewel/method run — allow minutes.
  - 'train' uses the method's manifest tuning dial from the LIVE release and
    trains on graded pairs with attached traces (the dataset report names what
    was excluded and why). The report's agreement is against the held-out
    ledger split — real decisions the model never saw. One run per method at a
    time. The trained model is an artifact + report for now; serving it is a
    later phase.
  - Time window defaults to the last 30 days when --start/--end are omitted.`;
