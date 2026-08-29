/**
 * Response types for the v2 analytics (insights) endpoints.
 *
 * Transcribed from youai-api:
 *   src/common/AnalyticsQuery/types.ts   — query/batch shapes
 *   src/http/routes/V2Apps/manage/analytics.ts  — per-endpoint responses
 *   src/common/Db/v2Apps/AnalyticsEventsDao.ts  — sources/map/ai-sources DAO
 *   src/common/Db/v2Apps/PresenceDao.ts          — live DAO
 *   src/common/Db/v2Apps/CrawlerHitsDao.ts       — crawlers DAO
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** The four measurable quantities the query engine can return per row. */
export type AnalyticsMetric = 'pageviews' | 'visitors' | 'visits' | 'events';

// ---------------------------------------------------------------------------
// query / batch
// ---------------------------------------------------------------------------

/** One row in a query result. `dimensions` contains the group-by key(s);
 * `metrics` contains only the requested-and-available metrics. */
export interface AnalyticsQueryResultRow {
  dimensions: Record<string, string>;
  metrics: Partial<Record<AnalyticsMetric, number>>;
}

/** Response shape for POST /insights/query. */
export interface AnalyticsQueryResult {
  results: AnalyticsQueryResultRow[];
  meta: {
    /** Whether the rollup table or the per-event table answered the query. */
    source: 'rollup' | 'events';
    /** ISO timestamps: what the client requested vs. what was actually served
     *  (events path clamps to the 90-day retention horizon). */
    window: { requested: [string, string]; served: [string, string] };
    /** True when the requested start was earlier than the retention horizon. */
    clamped: boolean;
    /** Metrics the client requested that this query shape cannot carry
     *  (e.g. `visits` on a grouped read). Omitted when empty. */
    metricsOmitted?: AnalyticsMetric[];
    /** Grouped queries only: unpaginated distinct-group count. */
    total?: number;
  };
}

/** Response shape for POST /insights/query-batch. One AnalyticsQueryResult
 *  per query, in request order. */
export interface AnalyticsBatchResult {
  results: AnalyticsQueryResult[];
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

/** One ranked traffic source row, with category + vendor classification
 *  applied server-side (UTM source values are classified the same way as
 *  referrer hosts — ChatGPT/Perplexity often arrive tagged
 *  ?utm_source=chatgpt.com). */
export interface AnalyticsSourceRow {
  sourceType: 'utm' | 'referrer' | 'direct';
  /** The utm_source value, referrer host, or the literal string "Direct". */
  sourceLabel: string;
  /** Session-start count (first pageview per 30-min gap). */
  visits: number;
  uniqueVisitors: number;
  /** High-level channel. 'direct' for direct traffic; one of the classifier
   *  categories for known hosts; 'other' for unrecognized referrers. */
  category: 'direct' | 'ai_assistant' | 'search' | 'social' | 'email' | 'other';
  /** Vendor label from the classifier (e.g. "Google", "OpenAI"), or null. */
  vendor: string | null;
}

/** Response shape for GET /insights/sources. */
export interface AnalyticsSourcesResult {
  results: AnalyticsSourceRow[];
  /** Unpaginated distinct-(sourceType, sourceLabel) count. */
  total: number;
}

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

/** One geo point for the city map view. Both the rollup and the per-event
 *  table return the same field set; the route dispatches to one or the other
 *  based on whether any click-filters are present. */
export interface AnalyticsMapPoint {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  pageviews: number;
  uniqueVisitors: number;
}

/** Response shape for GET /insights/map. */
export interface AnalyticsMapResult {
  points: AnalyticsMapPoint[];
  /** Unpaginated distinct-(city, country) count. */
  total: number;
}

// ---------------------------------------------------------------------------
// live
// ---------------------------------------------------------------------------

/** Response shape for GET /insights/live (one-shot snapshot). */
export interface AnalyticsLiveResult {
  /** Current unique visitor count (Redis SET cardinality). */
  count: number;
  /** Country breakdown of currently-online visitors, descending by count.
   *  Only visitors whose geo meta has not expired are included. */
  countries: Array<{ country: string; count: number }>;
  /** Up to 60 one-minute samples, chronological (oldest → newest),
   *  covering the last hour of activity. */
  sparkline: Array<{ ts: string; count: number }>;
}

// ---------------------------------------------------------------------------
// ai-sources
// ---------------------------------------------------------------------------

/** Per-host row from the raw AI-referral breakdown. */
export interface AnalyticsAiHostRow {
  host: string;
  pageviews: number;
  uniqueVisitors: number;
}

/** Per-vendor aggregate derived by summing the host-level rows. */
export interface AnalyticsAiVendorRow {
  vendor: string;
  pageviews: number;
  uniqueVisitors: number;
  /** All AI-assistant hosts that map to this vendor (e.g. both
   *  "chat.openai.com" and "chatgpt.com" roll up to "OpenAI"). */
  hosts: string[];
}

/** Response shape for GET /insights/ai-sources. */
export interface AnalyticsAiSourcesResult {
  /** Vendor-level totals, sorted descending by pageviews. */
  results: AnalyticsAiVendorRow[];
  /** Raw host-level rows before vendor aggregation. */
  hosts: AnalyticsAiHostRow[];
}

// ---------------------------------------------------------------------------
// crawlers
// ---------------------------------------------------------------------------

/** Response shape for GET /insights/crawlers/overview. */
export interface AnalyticsCrawlersOverviewResult {
  /** Total crawler hits in the window across all vendors. */
  totalHits: number;
  /** Hit count per bot vendor, sorted descending. */
  byVendor: Array<{ vendor: string; count: number }>;
  /** Most-crawled paths by total hits, descending. */
  topPages: Array<{ path: string; count: number }>;
}

/** One time bucket in the crawlers timeseries. */
export interface AnalyticsCrawlersTimeseriesBucket {
  /** ISO timestamp of the bucket's start. */
  start: string;
  /** Total hits across all vendors for this bucket. */
  total: number;
  /** Per-vendor hit counts keyed by vendor name. */
  byVendor: Record<string, number>;
}

/** Response shape for GET /insights/crawlers/timeseries. */
export interface AnalyticsCrawlersTimeseriesResult {
  buckets: AnalyticsCrawlersTimeseriesBucket[];
}

/** One raw crawler hit row. */
export interface AnalyticsCrawlersRecentRow {
  id: string;
  releaseId: string;
  path: string;
  host: string | null;
  botVendor: string;
  botName: string;
  country: string | null;
  createdAt: string;
}

/** Response shape for GET /insights/crawlers/recent. */
export interface AnalyticsCrawlersRecentResult {
  results: AnalyticsCrawlersRecentRow[];
}

/** Union of the three crawlers sub-responses. The sub is chosen at runtime
 *  (`analytics crawlers <overview|timeseries|recent>`). */
export type AnalyticsCrawlersResult =
  | AnalyticsCrawlersOverviewResult
  | AnalyticsCrawlersTimeseriesResult
  | AnalyticsCrawlersRecentResult;
