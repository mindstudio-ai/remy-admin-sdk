/**
 * CLI skin for the `events` group: command specs, Args-to-params mapping, and
 * help text. Operations live in ../ops/events.js (pure, typed); response
 * shapes in ../types/events.js. `tail` is CLI-only (cliStream.ts) — the
 * import layer stays non-streaming.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as events from '../ops/events.js';
import { tailSseToStdout } from '../cliStream.js';
import { fatal } from '../errors.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const eventsSpecs = {
  'events tail': {
    usage:
      'Usage: remy-admin events tail [<channel>] [--scope live] [--for 60]',
    positionals: [{ name: 'channel' }],
    flags: {
      scope: { type: 'string' },
      for: { type: 'number', min: 1, max: 600 },
    },
  },
  'events publish': {
    usage:
      'Usage: remy-admin events publish <channel> <json> [--scope live]\n' +
      "Publishes exactly as the app's own events.publish would — same validation, delivery, and metering.",
    positionals: [
      { name: 'channel', required: true },
      { name: 'json', required: true },
    ],
    flags: {
      scope: { type: 'string' },
    },
  },
  'events channels list': {
    usage: 'Usage: remy-admin events channels list [--scope live]',
    flags: {
      scope: { type: 'string' },
    },
  },
} satisfies Record<string, CommandSpec>;

async function eventsTail(ctx: AdminContext, a: Args) {
  const params = new URLSearchParams();
  const channel = a.str('channel');
  if (channel) {
    params.set('channel', channel);
  }
  const scope = a.str('scope');
  if (scope) {
    params.set('scope', scope);
  }
  const forSeconds = a.num('for');
  if (forSeconds !== undefined) {
    params.set('forSeconds', String(forSeconds));
  }
  const query = params.toString();
  await tailSseToStdout(
    ctx,
    `/_internal/v2/apps/${ctx.appId}/events/tail${query ? `?${query}` : ''}`,
  );
}

async function eventsPublish(ctx: AdminContext, a: Args) {
  const raw = a.req('json');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    fatal(`Invalid JSON payload: ${raw}`);
  }
  out(
    await events.publish(ctx, {
      channels: a.req('channel'),
      data,
      scope: a.str('scope'),
    }),
  );
}

async function eventsChannelsList(ctx: AdminContext, a: Args) {
  out(await events.channelsList(ctx, { scope: a.str('scope') }));
}

export const eventsHandlers = {
  'events tail': eventsTail,
  'events publish': eventsPublish,
  'events channels list': eventsChannelsList,
} satisfies Record<keyof typeof eventsSpecs, Handler>;

export const eventsHelp = `remy-admin events — Observe and test the app's realtime events (publish/subscribe).

Subcommands:
  tail           Print publishes live as they happen (bounded; default 60s, max 600)
  publish        Publish a test event, exactly as the app's own events.publish would
  channels list  Channels with recent publishes/subscriptions + live subscriber counts

Usage:
  remy-admin events tail [<channel>] [--scope live] [--for 60]
  remy-admin events publish <channel> <json> [--scope live]
  remy-admin events channels list [--scope live]

Examples:
  remy-admin events tail --for 30
  remy-admin events tail jobs:usr_123
  remy-admin events publish jobs:usr_123 '{"type":"ping"}'
  remy-admin events channels list

Notes:
  tail answers "is my backend publishing what I think it is": run it in one
  shell, trigger the publishing method in another, and each matching publish
  prints as one JSON value ({channel, data, ts}). It ends on its own after
  --for seconds (exit 0), so it is safe to run from a script.

  publish lets a frontend subscriber be verified before the backend trigger
  exists. The response's 'delivered' counts live subscriber connections per
  published channel — 0 means nobody is listening right now, which is normal,
  not an error.

  channels list is the mismatch-finder: a channel with subscribers but no
  recent publish (or the reverse) usually means the frontend and backend spell
  the channel differently. Window is 24h; channels are exact strings — there
  are no wildcards anywhere in app events.

  Scopes: events never cross execution environments. --scope defaults to
  'live'; use 'dev:<devSessionId>' to inspect a tunnel session's world or
  'preview:<releaseId>' for a branch preview.`;
