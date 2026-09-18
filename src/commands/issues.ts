/**
 * CLI skin for the `issues` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/issues.js (pure, typed); response
 * shapes in ../types/issues.js.
 *
 * CLI skin retains: reading a comment/description body from stdin.
 */

import fs from 'node:fs';
import { APP, type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as issues from '../ops/issues.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

const STATES = ['open', 'closed'] as const;
const LIST_STATES = ['open', 'closed', 'all'] as const;

export const issuesSpecs = {
  'issues list': {
    usage:
      'Usage: remy-admin issues list [--app <appId>] [--state open|closed|all] [--label <l>] [--from-app <appId>] [--limit 50] [--cursor <c>]',
    flags: {
      ...APP,
      state: { type: 'string', choices: LIST_STATES },
      label: { type: 'string', multiple: true },
      'from-app': { type: 'string' },
      limit: { type: 'number', min: 0 },
      cursor: { type: 'string' },
    },
  },
  'issues filed': {
    usage:
      'Usage: remy-admin issues filed [--app <appId>] [--state open|closed|all] [--label <l>] [--limit 50] [--cursor <c>]',
    flags: {
      ...APP,
      state: { type: 'string', choices: LIST_STATES },
      label: { type: 'string', multiple: true },
      limit: { type: 'number', min: 0 },
      cursor: { type: 'string' },
    },
  },
  'issues get': {
    usage: 'Usage: remy-admin issues get <number> [--app <appId>]',
    positionals: [{ name: 'number', required: true }],
    flags: { ...APP },
  },
  'issues create': {
    usage:
      'Usage: remy-admin issues create <title> [--app <appId>] [--body <text>|--body -] [--label <l>]',
    positionals: [{ name: 'title', required: true }],
    flags: {
      ...APP,
      body: { type: 'string' },
      label: { type: 'string', multiple: true },
    },
  },
  'issues comment': {
    usage:
      'Usage: remy-admin issues comment <number> <body> [--app <appId>]   (or --body - to read stdin)',
    positionals: [{ name: 'number', required: true }, { name: 'body' }],
    flags: { ...APP, body: { type: 'string' } },
    requireAnyOf: {
      flags: ['body'],
      positionals: ['body'],
      message: 'A comment body is required.',
    },
  },
  'issues close': {
    usage:
      'Usage: remy-admin issues close <number> [--app <appId>] [--comment <text>|--comment -]',
    positionals: [{ name: 'number', required: true }],
    flags: { ...APP, comment: { type: 'string' } },
  },
  'issues reopen': {
    usage: 'Usage: remy-admin issues reopen <number> [--app <appId>]',
    positionals: [{ name: 'number', required: true }],
    flags: { ...APP },
  },
  'issues edit': {
    usage:
      'Usage: remy-admin issues edit <number> [--app <appId>] [--title <t>] [--body <t>|--body -] [--label <l>] [--state open|closed]',
    positionals: [{ name: 'number', required: true }],
    flags: {
      ...APP,
      title: { type: 'string' },
      body: { type: 'string' },
      label: { type: 'string', multiple: true },
      state: { type: 'string', choices: STATES },
    },
    requireAnyOf: {
      flags: ['title', 'body', 'label', 'state'],
      message: 'Provide at least one of --title, --body, --label, --state',
    },
  },
  'issues delete': {
    usage: 'Usage: remy-admin issues delete <number> [--app <appId>]',
    positionals: [{ name: 'number', required: true }],
    flags: { ...APP },
  },
} satisfies Record<string, CommandSpec>;

// Resolve a stdin-capable flag: `-` reads stdin (for long multi-line markdown
// remy generates); a literal value is used as-is; absent → undefined.
function readStdinFlag(a: Args, flag: string): string | undefined {
  const val = a.str(flag);
  if (val === undefined) {
    return undefined;
  }
  if (val === '-') {
    return fs.readFileSync(0, 'utf-8');
  }
  return val;
}

function readBodyFlag(a: Args): string | undefined {
  return readStdinFlag(a, 'body');
}

// `--state all` is the absence of a filter, not a value the server knows: the
// list route treats a missing `status` as "any state" and 400s on anything
// outside open|closed. Translating here is what keeps `--state all` from
// silently returning only open issues.
function readStateFilter(a: Args): string | undefined {
  const state = a.str('state');
  return state === 'all' ? undefined : state;
}

async function issuesList(ctx: AdminContext, a: Args) {
  out(
    await issues.list(ctx, {
      status: readStateFilter(a),
      labels: a.list('label'),
      originAppId: a.str('from-app'),
      limit: a.num('limit'),
      cursor: a.str('cursor'),
    }),
  );
}
async function issuesFiled(ctx: AdminContext, a: Args) {
  out(
    await issues.filed(ctx, {
      status: readStateFilter(a),
      labels: a.list('label'),
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
  out(
    await issues.create(ctx, {
      title: a.req('title'),
      body: issueBody,
      labels: a.list('label'),
    }),
  );
}
async function issuesComment(ctx: AdminContext, a: Args) {
  const commentBody = readBodyFlag(a) ?? a.req('body');
  out(await issues.comment(ctx, a.req('number'), commentBody));
}
async function issuesClose(ctx: AdminContext, a: Args) {
  out(await issues.close(ctx, a.req('number'), readStdinFlag(a, 'comment')));
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
      labels: a.list('label'),
      status: a.str('state'),
    }),
  );
}
async function issuesDelete(ctx: AdminContext, a: Args) {
  out(await issues.del(ctx, a.req('number')));
}

export const issuesHandlers = {
  'issues list': issuesList,
  'issues filed': issuesFiled,
  'issues get': issuesGet,
  'issues create': issuesCreate,
  'issues comment': issuesComment,
  'issues close': issuesClose,
  'issues reopen': issuesReopen,
  'issues edit': issuesEdit,
  'issues delete': issuesDelete,
} satisfies Record<keyof typeof issuesSpecs, Handler>;

export const issuesHelp = `remy-admin issues — File and manage issues for this app, or for another app in the workspace.

Subcommands:
  list      List issues filed in an app (newest first)
  filed     List issues this app filed into other apps
  get       Get one issue + its comment thread
  create    File a new issue
  comment   Post a comment on an issue's thread
  close     Close an issue, optionally with a closing comment
  reopen    Reopen a closed issue
  edit      Edit an issue's title / body / labels / state
  delete    Delete an issue

Usage:
  remy-admin issues list [--app <appId>] [--state open|closed|all] [--label <l>] [--from-app <appId>] [--limit 50] [--cursor <c>]
  remy-admin issues filed [--app <appId>] [--state open|closed|all] [--label <l>] [--limit 50] [--cursor <c>]
  remy-admin issues get <number> [--app <appId>]
  remy-admin issues create <title> [--app <appId>] [--body <text>|--body -] [--label <l>]
  remy-admin issues comment <number> <body> [--app <appId>]   (or --body - to read stdin)
  remy-admin issues close <number> [--app <appId>] [--comment <text>|--comment -]
  remy-admin issues reopen <number> [--app <appId>]
  remy-admin issues edit <number> [--app <appId>] [--title <t>] [--body <t>|--body -] [--label <l>] [--state open|closed]
  remy-admin issues delete <number> [--app <appId>]

Notes:
  - <number> is the friendly per-app issue number (e.g. 42), shown as 'number' in output.
  - '--app <appId>' targets another app in the same workspace. Every app there is reachable
    with this credential, so it is a targeting flag: the issue lands in THAT app's tracker,
    and 'originAppId' on the row records that this app filed it. Cross-reference it in prose
    as 'app#42'.
  - 'list' shows what was filed IN an app; 'filed' shows what an app sent OUT to others —
    the whole fan-out in one call instead of one call per app.
  - '--label' repeats ('--label a --label b') or takes a comma-separated list ('--label a,b').
    Filtering matches an issue carrying ANY of them. Labels are an open set: pick your own.
  - '--state all' means no state filter (the default is also every state).
  - Issues and comments filed via this CLI are authored as the agent (authorKind: "agent").
  - '--body -' / '--comment -' read from stdin — use for long multi-line markdown.

Examples:
  remy-admin issues list --state open --label bug
  remy-admin issues create "Checkout 500s on empty cart" --label bug --body "Repro in comments"
  remy-admin issues create "Apply the new auth spec" --app 8f3c... --label fleet-patch --body -
  remy-admin issues filed --state open
  remy-admin issues comment 42 "Fixed in the latest release."
  remy-admin issues close 42 --comment "Already fixed in v3 — no change needed."`;
