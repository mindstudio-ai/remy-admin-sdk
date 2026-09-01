/**
 * Response types for the v2 app-events observability endpoints.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/appEvents.ts          — routes
 *   src/http/routes/V2Apps/serve/events/registry.ts     — ChannelActivityRow
 *   src/http/routes/V2Apps/serve/events/publish.ts      — delivered semantics
 */

/** One channel's recent activity, from the channels view. */
export interface EventChannelActivity {
  channel: string;
  /** Last publish naming this channel (ms since epoch), if any in 24h. */
  lastPublishAt?: number;
  /** Last subscription naming this channel (ms since epoch), if any in 24h. */
  lastSubscribeAt?: number;
  /** Live subscriber connections right now. */
  subscribers: number;
}

/** GET /_internal/v2/apps/:appId/events/channels */
export interface EventsChannelsListResult {
  /** The environment scope inspected: `live` | `preview:<id>` | `dev:<id>`. */
  scope: string;
  /** Recency-sorted, capped at 200 rows, 24h window. */
  channels: EventChannelActivity[];
}

/** POST /_internal/v2/apps/:appId/events/publish */
export interface EventsPublishResult {
  /**
   * Live subscriber connections counted across the published channels.
   * `0` means nobody is listening right now — normal for a nudge, not an
   * error.
   */
  delivered: number;
  scope: string;
}

/** One frame printed by `events tail` (also the subscribe stream's shape). */
export interface EventsTailFrame {
  channel: string;
  data: unknown;
  /** Publish time, ms since epoch. */
  ts: number;
}
