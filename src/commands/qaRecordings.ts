/**
 * CLI skin for the `qa-recordings` group: command specs, Args-to-params
 * mapping, and help text. Operations live in ../ops/qaRecordings.js; response
 * shapes in ../types/qaRecordings.js.
 *
 * The group is named for the store it reads (`qa-recordings`), so
 * `qa-recordings ls` and `files ls --store qa-recordings` are visibly the same
 * objects. Hyphenated on the command line, `qaRecordings` in the import layer —
 * the same split `datasources` / `dataSources` uses.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as qaRecordings from '../ops/qaRecordings.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const qaRecordingsSpecs = {
  'qa-recordings ls': {
    usage:
      'Usage: remy-admin qa-recordings ls [--session <id>] [--cursor <cursor>] [--limit <n>]',
    flags: {
      session: { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'number', min: 1 },
    },
  },
  'qa-recordings export': {
    usage:
      'Usage: remy-admin qa-recordings export --session <id> --from <epochMs> --to <epochMs> [--store <name>] [--private]',
    flags: {
      session: { type: 'string' },
      from: { type: 'number' },
      to: { type: 'number' },
      store: { type: 'string' },
      private: { type: 'boolean' },
    },
  },
} satisfies Record<string, CommandSpec>;

async function qaRecordingsLs(ctx: AdminContext, a: Args) {
  out(
    await qaRecordings.ls(ctx, {
      sessionId: a.str('session'),
      cursor: a.str('cursor'),
      limit: a.num('limit'),
    }),
  );
}

async function qaRecordingsExport(ctx: AdminContext, a: Args) {
  const sessionId = a.str('session');
  const from = a.num('from');
  const to = a.num('to');
  if (!sessionId) {
    fatal('--session is required (see `remy-admin qa-recordings ls`).');
  }
  if (from === undefined || to === undefined) {
    fatal(
      '--from and --to are required (epoch milliseconds). A QA run reports ' +
        'both on its result.',
    );
  }
  const result = await qaRecordings.exportVideo(ctx, {
    sessionId,
    from,
    to,
    store: a.str('store'),
    access: a.bool('private') ? 'private' : undefined,
  });
  // A render that ran and failed still answers 200 with a reason; the CLI has
  // to exit non-zero on it, or a caller shell-scripting this would treat a
  // missing video as a success.
  if (result.status !== 'completed') {
    fatal(
      result.errorCode === 'FFMPEG_UNAVAILABLE'
        ? 'This sandbox has no ffmpeg — video export needs a box on the current devbox image.'
        : (result.error ?? `Export ${result.status}.`),
    );
  }
  out(result);
}

export const qaRecordingsHandlers = {
  'qa-recordings ls': qaRecordingsLs,
  'qa-recordings export': qaRecordingsExport,
} satisfies Record<keyof typeof qaRecordingsSpecs, Handler>;

export const qaRecordingsHelp = `remy-admin qa-recordings — Browser-QA session replays.

Every automated browser test records what the page did, as rrweb (a DOM
recording, not video). The chunks are ordinary private files in the
'qa-recordings' store, so 'remy-admin files' works on them directly: sign one
for a link, download one, or copy one into a public store to embed it.

'export' turns a replay into an mp4 — the shareable artifact, for a changelog
entry, a release note or a bug report. It renders on the dev box (real browser,
real ffmpeg, no AI-generated frames), so it only works inside a sandbox, it
blocks for the length of the clip, and it won't start while a video export is
already running.

Subcommands:
  ls      Recording sessions in this app, grouped into runs
  export  Render a window of a session to an mp4 and print where it landed

Usage:
  remy-admin qa-recordings ls [--session <id>] [--limit <n>]
  remy-admin qa-recordings export --session <id> --from <epochMs> --to <epochMs> [--store <name>] [--private]

Options:
  --session   Recording session id (32 hex characters)
  --from/--to The window to render, as epoch milliseconds. A QA run prints the
              session and both bounds on its result.
  --store     Destination store for the mp4 (default: assets)
  --private   Write the mp4 privately instead of publicly. No URL is returned;
              use 'files sign' to make one.

Examples:
  # What was recorded recently
  remy-admin qa-recordings ls --limit 200

  # Render a run and get a public URL to embed
  remy-admin qa-recordings export --session 9f2c… --from 1758000000000 --to 1758000042000

  # The raw rrweb chunks for a session (download, inspect, or rehost)
  remy-admin files ls --private --store qa-recordings --prefix 9f2c…/`;
