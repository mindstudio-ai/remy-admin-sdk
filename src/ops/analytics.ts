/**
 * Analytics (insights) operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/analytics.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  AnalyticsAiSourcesResult,
  AnalyticsBatchResult,
  AnalyticsCrawlersResult,
  AnalyticsLiveResult,
  AnalyticsMapResult,
  AnalyticsQueryResult,
  AnalyticsSourcesResult,
} from '../types/analytics.js';

/** Scope + time-window + click-filter params accepted by `sources`. */
export interface SourcesParams {
  /** Scope to a specific release id. */
  releaseId?: string;
  /** ISO date string for the start of the query window. */
  start?: string;
  /** ISO date string for the end of the query window. */
  end?: string;
  /** Max rows to return (default 25). */
  limit?: number;
  /** Row offset for paging. */
  offset?: number;
  /** Click-filter: equality match on path. Per-event-table backed (90-day retention). */
  path?: string;
  /** Click-filter: equality match on referrer host. Per-event-table backed (90-day retention). */
  referrerHost?: string;
  /** Click-filter: equality match on country. Per-event-table backed (90-day retention). */
  country?: string;
  /** Click-filter: equality match on city. Per-event-table backed (90-day retention). */
  city?: string;
  /** Click-filter: equality match on device type. Per-event-table backed (90-day retention). */
  device?: string;
  /** Click-filter: equality match on browser. Per-event-table backed (90-day retention). */
  browser?: string;
  /** Click-filter: equality match on OS. Per-event-table backed (90-day retention). */
  os?: string;
  /** Click-filter: equality match on language. Per-event-table backed (90-day retention). */
  language?: string;
  /** Click-filter: equality match on UTM source. Per-event-table backed (90-day retention). */
  utmSource?: string;
  /** Click-filter: equality match on UTM medium. Per-event-table backed (90-day retention). */
  utmMedium?: string;
  /** Click-filter: equality match on UTM campaign. Per-event-table backed (90-day retention). */
  utmCampaign?: string;
}

/** Same click-filter + scope params as `SourcesParams`; accepted by `map`. */
export interface MapParams {
  /** Scope to a specific release id. */
  releaseId?: string;
  /** ISO date string for the start of the query window. */
  start?: string;
  /** ISO date string for the end of the query window. */
  end?: string;
  /** Max points to return (default 500). */
  limit?: number;
  /** Row offset for paging. */
  offset?: number;
  /** Click-filter: equality match on path. Per-event-table backed (90-day retention). */
  path?: string;
  /** Click-filter: equality match on referrer host. Per-event-table backed (90-day retention). */
  referrerHost?: string;
  /** Click-filter: equality match on country. Per-event-table backed (90-day retention). */
  country?: string;
  /** Click-filter: equality match on city. Per-event-table backed (90-day retention). */
  city?: string;
  /** Click-filter: equality match on device type. Per-event-table backed (90-day retention). */
  device?: string;
  /** Click-filter: equality match on browser. Per-event-table backed (90-day retention). */
  browser?: string;
  /** Click-filter: equality match on OS. Per-event-table backed (90-day retention). */
  os?: string;
  /** Click-filter: equality match on language. Per-event-table backed (90-day retention). */
  language?: string;
  /** Click-filter: equality match on UTM source. Per-event-table backed (90-day retention). */
  utmSource?: string;
  /** Click-filter: equality match on UTM medium. Per-event-table backed (90-day retention). */
  utmMedium?: string;
  /** Click-filter: equality match on UTM campaign. Per-event-table backed (90-day retention). */
  utmCampaign?: string;
}

export interface AiSourcesParams {
  /** Scope to a specific release id. */
  releaseId?: string;
  /** ISO date string for the start of the query window. */
  start?: string;
  /** ISO date string for the end of the query window. */
  end?: string;
  /** Max vendor rows to return (default 50). */
  limit?: number;
}

export interface CrawlersParams {
  /**
   * Sub-endpoint to dispatch to:
   * - `overview` — vendor totals + top-crawled pages.
   * - `timeseries` — stacked-per-vendor hit counts bucketed over time.
   * - `recent` — last N raw crawler hit rows (curiosity feed).
   */
  kind: 'overview' | 'timeseries' | 'recent';
  /** Scope to a specific release id. */
  releaseId?: string;
  /** ISO date string for the start of the query window. */
  start?: string;
  /** ISO date string for the end of the query window. */
  end?: string;
  /** Max rows to return (default varies by sub). */
  limit?: number;
  /** Number of time buckets for `timeseries` (default 24). */
  buckets?: number;
  /** Max top-pages rows for `overview` (default 20, max 100). */
  topPagesLimit?: number;
}

/**
 * Run a single analytics query: metrics × dimensions × filters × time.
 *
 * The query body shape (all fields optional except `metrics`):
 * ```
 * metrics      ["pageviews" | "visitors" | "visits" | "events", ...]
 * dimensions   at most ONE entity dimension OR "time" (not both):
 *              path referrerHost sourceCategory country city deviceType
 *              browser os language visitorType utmSource utmMedium
 *              utmCampaign utmTerm utmContent eventName
 * granularity  required with "time": "5m" | "hour" | "day" | "week" | "month"
 * timezone     IANA zone for day/week/month boundaries (default UTC)
 * filters      [[op, dimension, [values...]], ...]
 *              ops: "is" (any of) | "is_not" (none of) | "contains"
 * dateRange    "1h" | "24h" | "7d" | "30d" | "90d" | "all"
 *              or ["<startISO>", "<endISO>"]   (default "24h")
 * orderBy      grouped only: [["pageviews" | "events", "asc" | "desc"]]
 * limit        grouped only; default 25, max 1000
 * offset       paging
 * releaseId    optional release scope
 * ```
 *
 * Routing (rollup vs per-event table), window clamping, and metric
 * availability are determined by the query shape; the response `meta`
 * reports `source`, `window.served`, `clamped`, and `metricsOmitted`.
 * Summary KPIs, timeseries, every top-N, and event stats are all query
 * compositions — no dedicated endpoints exist for them.
 *
 * @example
 * const { results, meta } = await admin.analytics.query({
 *   metrics: ['pageviews', 'visitors'],
 *   dimensions: ['path'],
 *   dateRange: '30d',
 *   limit: 10,
 * });
 */
export function query(ctx: AdminContext, body: Record<string, unknown>) {
  return call<AnalyticsQueryResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/insights/query`,
    body,
  );
}

/**
 * Run up to 10 independent query bodies in one round trip.
 *
 * Results are in request order; each entry is a full `AnalyticsQueryResult`
 * (with its own `meta`).  Accepts a bare array of query bodies or the wire
 * shape `{ queries: [...] }`.
 *
 * @example
 * const { results } = await admin.analytics.batch([
 *   { metrics: ['pageviews', 'visits', 'visitors'] },
 *   { metrics: ['pageviews'], dimensions: ['path'], limit: 10 },
 * ]);
 */
export function batch(ctx: AdminContext, queries: unknown[] | undefined) {
  return call<AnalyticsBatchResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/insights/query-batch`,
    { queries },
  );
}

/**
 * Ranked traffic sources: per-session first source (UTM > referrer > direct),
 * with category and vendor classification applied server-side.
 *
 * Per-event-table backed — bounded by 90-day retention.  Click-filter params
 * accept equality only; use `query` with `"is_not"` / `"contains"` filters or
 * multi-dimension grouping for richer analysis.
 *
 * @example
 * const { results, total } = await admin.analytics.sources({ limit: 10 });
 */
export function sources(ctx: AdminContext, params: SourcesParams = {}) {
  return call<AnalyticsSourcesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/insights/sources${qs(params)}`,
  );
}

/**
 * City lat/lon points for geo rendering.
 *
 * When any click-filter is present the per-event table is queried (90-day
 * retention); without filters the rollup table is used (full history).
 *
 * @example
 * const { points, total } = await admin.analytics.map({ country: 'US' });
 */
export function map(ctx: AdminContext, params: MapParams = {}) {
  return call<AnalyticsMapResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/insights/map${qs(params)}`,
  );
}

/**
 * One-shot live visitor snapshot: current unique count, country breakdown,
 * and up to 60 one-minute sparkline samples from the last hour.
 *
 * Backed by Redis presence keys; no analytics-table query.
 *
 * @example
 * const { count, countries, sparkline } = await admin.analytics.live();
 */
export function live(ctx: AdminContext) {
  return call<AnalyticsLiveResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/insights/live`,
  );
}

/**
 * Per-vendor AI-referral breakdown.
 *
 * Filters referrer-host rows to known AI-assistant hosts and aggregates up
 * to vendor level at read time.  Multiple hosts may map to the same vendor
 * (e.g. `chat.openai.com` + `chatgpt.com` → OpenAI).  Returns both the
 * vendor-level aggregates and the raw host-level rows.
 *
 * @example
 * const { results, hosts } = await admin.analytics.aiSources();
 */
export function aiSources(ctx: AdminContext, params: AiSourcesParams = {}) {
  return call<AnalyticsAiSourcesResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/insights/ai-sources${qs(params)}`,
  );
}

/**
 * AI-crawler / bot ingestion views.
 *
 * Dispatches to one of three sub-endpoints via `kind`:
 * - `overview` — total hits + per-vendor breakdown + top-crawled pages.
 * - `timeseries` — stacked-per-vendor hit counts bucketed over time.
 * - `recent` — last N raw crawler hit rows.
 *
 * Covers all bot traffic (AI assistants, search-engine crawlers, and a
 * generic "Other" bucket), not just AI crawlers.
 *
 * @example
 * const overview = await admin.analytics.crawlers({ kind: 'overview', topPagesLimit: 10 });
 */
export function crawlers(ctx: AdminContext, params: CrawlersParams) {
  const { kind, ...rest } = params;
  return call<AnalyticsCrawlersResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/insights/crawlers/${seg(kind)}${qs(rest)}`,
  );
}
