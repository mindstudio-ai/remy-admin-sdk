/**
 * App-events observability operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. The live tail is CLI-only (src/cliStream.ts) — the
 * import layer stays non-streaming by design.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import type {
  EventsChannelsListResult,
  EventsPublishResult,
} from '../types/events.js';

export interface EventsScopeParams {
  /**
   * Environment scope to inspect: `live` (default), `preview:<releaseId>`,
   * or `dev:<sessionId>` — publishes and subscriptions never cross scopes,
   * so a tunnel session's events are visible only under its `dev:` scope.
   */
  scope?: string;
}

export interface EventsPublishParams extends EventsScopeParams {
  /** Exact channel name(s) — no wildcards anywhere in app events. */
  channels: string | string[];
  /** The payload subscribers receive (≤32k serialized characters). */
  data: unknown;
}

/**
 * Channels with a publish or a subscription in the last 24h, with live
 * subscriber counts — recency-sorted, capped at 200.
 *
 * The debugging read: a channel with subscribers but no publishes (or the
 * reverse) usually means the frontend and backend spell the channel
 * differently.
 *
 * @example
 * const { channels } = await admin.events.channelsList();
 * const mismatch = channels.filter((c) => c.subscribers > 0 && !c.lastPublishAt);
 */
export function channelsList(
  ctx: AdminContext,
  params: EventsScopeParams = {},
) {
  return call<EventsChannelsListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/events/channels${qs(params)}`,
  );
}

/**
 * Publish a test event, exactly as the app's own `events.publish` would —
 * same validation, same delivery, same metering. Lets a frontend subscriber
 * be verified before the backend trigger exists.
 *
 * `delivered` counts live subscriber connections per published channel;
 * `0` is normal (nobody listening), never an error.
 *
 * @throws AdminApiError `invalid_channels` / `payload_too_large` (400).
 * @example
 * const { delivered } = await admin.events.publish({
 *   channels: 'jobs:usr_123',
 *   data: { type: 'ping' },
 * });
 */
export function publish(ctx: AdminContext, params: EventsPublishParams) {
  return call<EventsPublishResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/events/publish`,
    { channels: params.channels, data: params.data, scope: params.scope },
  );
}
