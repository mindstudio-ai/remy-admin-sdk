/**
 * CLI skin for the `issues` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/issues.js (pure, typed); response
 * shapes in ../types/issues.js.
 *
 * CLI skin retains: reading a comment/description body from stdin.
 */

import fs from 'node:fs';
import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as issues from '../ops/issues.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const issuesSpecs = {
  'issues list': {
    usage:
      'Usage: remy-admin issues list [--status open|closed] [--kind bug|idea|task] [--limit 50] [--cursor <c>]',
    flags: {
      status: { type: 'string' },
      kind: { type: 'string' },
      limit: { type: 'number', min: 0 },
      cursor: { type: 'string' },
    },
  },
  'issues get': {
    usage: 'Usage: remy-admin issues get <number>',
    positionals: [{ name: 'number', required: true }],
  },
  'issues create': {
    usage:
      'Usage: remy-admin issues create <title> [--body <text>|--body -] [--kind bug|idea|task]',
    positionals: [{ name: 'title', required: true }],
    flags: { body: { type: 'string' }, kind: { type: 'string' } },
  },
  'issues comment': {
    usage:
      'Usage: remy-admin issues comment <number> <body>   (or --body - to read stdin)',
    positionals: [{ name: 'number', required: true }, { name: 'body' }],
    flags: { body: { type: 'string' } },
    requireAnyOf: {
      flags: ['body'],
      positionals: ['body'],
      message: 'A comment body is required.',
    },
  },
  'issues close': {
    usage: 'Usage: remy-admin issues close <number>',
    positionals: [{ name: 'number', required: true }],
  },
  'issues reopen': {
    usage: 'Usage: remy-admin issues reopen <number>',
    positionals: [{ name: 'number', required: true }],
  },
  'issues edit': {
    usage:
      'Usage: remy-admin issues edit <number> [--title <t>] [--body <t>|--body -] [--kind ...] [--status open|closed]',
    positionals: [{ name: 'number', required: true }],
    flags: {
      title: { type: 'string' },
      body: { type: 'string' },
      kind: { type: 'string' },
      status: { type: 'string' },
    },
    requireAnyOf: {
      flags: ['title', 'body', 'kind', 'status'],
      message: 'Provide at least one of --title, --body, --kind, --status',
    },
  },
  'issues delete': {
    usage: 'Usage: remy-admin issues delete <number>',
    positionals: [{ name: 'number', required: true }],
  },
} satisfies Record<string, CommandSpec>;

// Resolve a --body value: `--body -` reads stdin (for long multi-line
// markdown remy generates); `--body <text>` uses the literal; absent → undefined.
function readBodyFlag(a: Args): string | undefined {
  const val = a.str('body');
  if (val === undefined) {
    return undefined;
  }
  if (val === '-') {
    return fs.readFileSync(0, 'utf-8');
  }
  return val;
}

async function issuesList(ctx: AdminContext, a: Args) {
  out(
    await issues.list(ctx, {
      status: a.str('status'),
      kind: a.str('kind'),
      limit: a.num('limit'),
      cursor: a.str('cursor'),
    }),
  );
}
async function issuesGet(ctx: AdminContext, a: Args) {
  out(await issues.get(ctx, a.req('number')));
}
async function issuesCreate(ctx: AdminContext, a: Args) {
  // Everything the CLI files is authored as the agent.
  const issueBody = readBodyFlag(a);
  const kind = a.str('kind');
  out(
    await issues.create(ctx, {
      title: a.req('title'),
      body: issueBody,
      kind: kind,
    }),
  );
}
async function issuesComment(ctx: AdminContext, a: Args) {
  const commentBody = readBodyFlag(a) ?? a.req('body');
  out(await issues.comment(ctx, a.req('number'), commentBody));
}
async function issuesClose(ctx: AdminContext, a: Args) {
  out(await issues.close(ctx, a.req('number')));
}
async function issuesReopen(ctx: AdminContext, a: Args) {
  out(await issues.reopen(ctx, a.req('number')));
}
async function issuesEdit(ctx: AdminContext, a: Args) {
  const editBody = readBodyFlag(a);
  out(
    await issues.edit(ctx, a.req('number'), {
      title: a.str('title'),
      body: editBody,
      kind: a.str('kind'),
      status: a.str('status'),
    }),
  );
}
async function issuesDelete(ctx: AdminContext, a: Args) {
  out(await issues.del(ctx, a.req('number')));
}

export const issuesHandlers = {
  'issues list': issuesList,
  'issues get': issuesGet,
  'issues create': issuesCreate,
  'issues comment': issuesComment,
  'issues close': issuesClose,
  'issues reopen': issuesReopen,
  'issues edit': issuesEdit,
  'issues delete': issuesDelete,
} satisfies Record<keyof typeof issuesSpecs, Handler>;

export const issuesHelp = `remy-admin issues — File and manage issues (bugs, ideas, tasks) for the app.

Subcommands:
  list      List issues (newest first)
  get       Get one issue + its comment thread
  create    File a new issue
  comment   Post a comment on an issue's thread
  close     Close an issue
  reopen    Reopen a closed issue
  edit      Edit an issue's title / body / kind / status
  delete    Delete an issue

Usage:
  remy-admin issues list [--status open|closed] [--kind bug|idea|task] [--limit 50] [--cursor <c>]
  remy-admin issues get <number>
  remy-admin issues create <title> [--body <text>|--body -] [--kind bug|idea|task]
  remy-admin issues comment <number> <body>          (or --body - to read stdin)
  remy-admin issues close <number>
  remy-admin issues reopen <number>
  remy-admin issues edit <number> [--title <t>] [--body <t>|--body -] [--kind ...] [--status open|closed]
  remy-admin issues delete <number>

Notes:
  - <number> is the friendly per-app issue number (e.g. 42), shown as 'number' in output.
  - Issues and comments filed via this CLI are authored as the agent (authorKind: "agent").
  - '--body -' reads the body from stdin — use it for long multi-line markdown.

Examples:
  remy-admin issues list --status open --kind bug
  remy-admin issues create "Checkout 500s on empty cart" --kind bug --body "Repro in comments"
  echo "Long markdown body..." | remy-admin issues create "Refactor auth flow" --kind task --body -
  remy-admin issues comment 42 "Fixed in the latest release."
  remy-admin issues close 42`;
