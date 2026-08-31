/**
 * CLI skin for the `agent` group: command specs, Args-to-params mapping, and
 * help text. Operations live in ../ops/agent.js (pure, typed); response shapes
 * in ../types/agent.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as agent from '../ops/agent.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const agentSpecs = {
  'agent threads list': {
    usage:
      'Usage: remy-admin agent threads list [--limit 20] [--cursor <nextCursor>]',
    flags: {
      limit: { type: 'number', min: 1, max: 100 },
      cursor: { type: 'string' },
    },
  },
  'agent threads get': {
    usage: 'Usage: remy-admin agent threads get <threadId>',
    positionals: [{ name: 'threadId', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function threadsList(ctx: AdminContext, a: Args) {
  out(
    await agent.threadsList(ctx, {
      limit: a.num('limit'),
      cursor: a.str('cursor'),
    }),
  );
}

async function threadsGet(ctx: AdminContext, a: Args) {
  out(await agent.threadsGet(ctx, a.req('threadId')));
}

export const agentHandlers = {
  'agent threads list': threadsList,
  'agent threads get': threadsGet,
} satisfies Record<keyof typeof agentSpecs, Handler>;

export const agentHelp = `remy-admin agent — Conversation log for the app's agent (chat) interface.

Subcommands:
  threads list  Every conversation, newest activity first (transcripts excluded)
  threads get   One conversation with its full transcript

Usage:
  remy-admin agent threads list [--limit 20] [--cursor <nextCursor>]
  remy-admin agent threads get <threadId>

Examples:
  remy-admin agent threads list --limit 10
  remy-admin agent threads get 4f6c…

Notes:
  Transcripts are how you iterate on an agent: after the user tests it, read
  'threads get' for what was actually said and which tools ran with which
  arguments, then fix the system prompt and tool descriptions from that evidence
  rather than from guesses.

  In the list, 'toolErrorCount' and 'hasTurnError' point at the conversations
  worth opening — a failed tool call, or a turn that broke (model error, rate
  limit, credits) instead of replying. 'devSession' is true for your own test
  conversations through the dev tunnel, so you can tell them from real traffic.

  In a transcript, each message is the stored conversation's own shape: 'user'
  for a person's message and also for a tool result (which carries
  'toolCallId'), 'assistant' for the agent (carrying 'toolCalls' when it asked
  for tools). A method tool call also carries a 'requestId' — pass it to
  'remy-admin requests get <requestId>' for that call's input, output, stdout
  and error. Client tools run in the browser, so they have no requestId.`;
