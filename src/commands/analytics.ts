/**
 * CLI skin for the `analytics` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/analytics.js (pure, typed); response
 * shapes in ../types/analytics.js.
 *
 * CLI skin retains: parsing the user-supplied query/batch JSON bodies (UsageError
 * with the grammar pointer on bad input).
 */

import { WINDOW, type Args, type CommandSpec, type FlagSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { UsageError } from '../errors.js';
import * as analytics from '../ops/analytics.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

const CRAWLERS_SUBS = ['overview', 'timeseries', 'recent'] as const;

/**
 * The 11 click-filter flags shared by the reads that honor them (sources,
 * map). Equality-only; richer filtering (is_not/contains, multi-value) lives
 * in the `query` JSON grammar.
 */
const FILTERS = {
  path: { type: 'string' },
  referrer: { type: 'string' },
  country: { type: 'string' },
  city: { type: 'string' },
  device: { type: 'string' },
  browser: { type: 'string' },
  os: { type: 'string' },
  language: { type: 'string' },
  'utm-source': { type: 'string' },
  'utm-medium': { type: 'string' },
  'utm-campaign': { type: 'string' },
} as const satisfies Record<string, FlagSpec>;

const SCOPE = {
  release: { type: 'string' },
  ...WINDOW,
} as const satisfies Record<string, FlagSpec>;

export const analyticsSpecs = {
  'analytics query': {
    usage: `Usage: remy-admin analytics query '<json>'`,
    positionals: [{ name: 'body', required: true }],
  },
  'analytics batch': {
    usage: `Usage: remy-admin analytics batch '<json array of query bodies>'`,
    positionals: [{ name: 'body', required: true }],
  },
  'analytics sources': {
    usage:
      'Usage: remy-admin analytics sources [--limit 25] [--offset 0] [scope + filters]',
    flags: {
      ...SCOPE,
      limit: { type: 'number', min: 0 },
      offset: { type: 'number', min: 0 },
      ...FILTERS,
    },
  },
  'analytics map': {
    usage:
      'Usage: remy-admin analytics map [--limit 500] [--offset 0] [scope + filters]',
    flags: {
      ...SCOPE,
      limit: { type: 'number', min: 0 },
      offset: { type: 'number', min: 0 },
      ...FILTERS,
    },
  },
  'analytics live': {
    usage: 'Usage: remy-admin analytics live',
  },
  'analytics ai-sources': {
    usage:
      'Usage: remy-admin analytics ai-sources [--limit 50] [--start ...] [--end ...] [--release ...]',
    flags: {
      ...SCOPE,
      limit: { type: 'number', min: 0 },
    },
  },
  'analytics crawlers': {
    usage: `Usage: remy-admin analytics crawlers <sub>. Subs: ${CRAWLERS_SUBS.join('|')}`,
    positionals: [
      {
        name: 'sub',
        required: true,
        choices: CRAWLERS_SUBS,
        choiceLabel: 'Unknown crawlers sub',
      },
    ],
    // Union of the three subs' flags; the API ignores what a sub doesn't use.
    flags: {
      ...SCOPE,
      limit: { type: 'number', min: 0 },
      buckets: { type: 'number', min: 1 },
      'top-pages-limit': { type: 'number', min: 1 },
    },
  },
} satisfies Record<string, CommandSpec>;

async function analyticsQuery(ctx: AdminContext, a: Args) {
  const raw = a.req('body');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err: any) {
    throw new UsageError(
      `analytics query body is not valid JSON (${err.message}). Run 'remy-admin analytics --help' for the grammar.`,
      analyticsSpecs['analytics query'].usage,
    );
  }
  out(await analytics.query(ctx, body as Record<string, unknown>));
}
async function analyticsBatch(ctx: AdminContext, a: Args) {
  const raw = a.req('body');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err: any) {
    throw new UsageError(
      `analytics batch body is not valid JSON (${err.message}). Pass an array of query bodies.`,
      analyticsSpecs['analytics batch'].usage,
    );
  }
  // Accept a bare array or the wire shape {queries: [...]}.
  const queries = Array.isArray(body)
    ? body
    : (body as { queries?: unknown[] } | null)?.queries;
  out(await analytics.batch(ctx, queries));
}
async function analyticsSources(ctx: AdminContext, a: Args) {
  out(
    await analytics.sources(ctx, {
      releaseId: a.str('release'),
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
      offset: a.num('offset'),
      path: a.str('path'),
      referrerHost: a.str('referrer'),
      country: a.str('country'),
      city: a.str('city'),
      device: a.str('device'),
      browser: a.str('browser'),
      os: a.str('os'),
      language: a.str('language'),
      utmSource: a.str('utm-source'),
      utmMedium: a.str('utm-medium'),
      utmCampaign: a.str('utm-campaign'),
    }),
  );
}
async function analyticsMap(ctx: AdminContext, a: Args) {
  out(
    await analytics.map(ctx, {
      releaseId: a.str('release'),
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
      offset: a.num('offset'),
      path: a.str('path'),
      referrerHost: a.str('referrer'),
      country: a.str('country'),
      city: a.str('city'),
      device: a.str('device'),
      browser: a.str('browser'),
      os: a.str('os'),
      language: a.str('language'),
      utmSource: a.str('utm-source'),
      utmMedium: a.str('utm-medium'),
      utmCampaign: a.str('utm-campaign'),
    }),
  );
}
async function analyticsLive(ctx: AdminContext) {
  out(await analytics.live(ctx));
}
async function analyticsAiSources(ctx: AdminContext, a: Args) {
  out(
    await analytics.aiSources(ctx, {
      releaseId: a.str('release'),
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
    }),
  );
}
async function analyticsCrawlers(ctx: AdminContext, a: Args) {
  out(
    await analytics.crawlers(ctx, {
      kind: a.req('sub') as 'overview' | 'timeseries' | 'recent',
      releaseId: a.str('release'),
      start: a.str('start'),
      end: a.str('end'),
      limit: a.num('limit'),
      buckets: a.num('buckets'),
      topPagesLimit: a.num('top-pages-limit'),
    }),
  );
}

export const analyticsHandlers = {
  'analytics query': analyticsQuery,
  'analytics batch': analyticsBatch,
  'analytics sources': analyticsSources,
  'analytics map': analyticsMap,
  'analytics live': analyticsLive,
  'analytics ai-sources': analyticsAiSources,
  'analytics crawlers': analyticsCrawlers,
} satisfies Record<keyof typeof analyticsSpecs, Handler>;

export const analyticsHelp = `remy-admin analytics — Traffic, top-N, geo, and AI-referral insights.

Subcommands:
  query '<json>'                 The general read: metrics x dimensions x
                                 filters x time (summary KPIs, timeseries,
                                 top-N, and event stats are all query shapes)
  batch '<json array>'           Up to 10 query bodies in one round trip;
                                 results in request order
  sources                        Ranked traffic sources (per-session first
                                 source: UTM > referrer > direct, classified)
  map                            City lat/lon points for geo rendering
  live                           One-shot live counter (count + countries + sparkline)
  ai-sources                     Per-vendor AI-referral breakdown
  crawlers <overview|timeseries|recent>
                                 AI-crawler / bot ingestion views

The query JSON body:
  metrics      required: ["pageviews" | "visitors" | "visits" | "events", ...]
  dimensions   at most ONE entity dimension OR "time" (not both):
               path referrerHost sourceCategory country city deviceType
               browser os language visitorType utmSource utmMedium
               utmCampaign utmTerm utmContent eventName
  granularity  required with "time": "5m" | "hour" | "day" | "week" | "month"
  timezone     IANA zone for day/week/month boundaries (default UTC)
  filters      [[op, dimension, [values...]], ...]
               ops: "is" (any of) | "is_not" (none of; missing still matches)
                    | "contains" (case-insensitive substring)
  dateRange    "1h" | "24h" | "7d" | "30d" | "90d" | "all"
               or ["<startISO>", "<endISO>"]   (default "24h")
               with "all", granularity is a minimum (server coarsens as
               history grows); city filter values are plain city names
  orderBy      grouped only: [["pageviews" | "events", "asc" | "desc"]]
  limit        grouped only, default 25, max 1000; offset for paging
  releaseId    optional release scope

How far back a query can look depends on its shape: all-"is" filters touching
at most ONE dimension read a rollup kept forever (full lifetime history);
cross-dimension, "is_not", and "contains" queries scan raw events retained 90
days — the server clamps the window. The response meta says what happened:
source ("rollup" | "events"), window.served, clamped, metricsOmitted (metrics
this shape can't carry — e.g. visits on grouped reads), total (group count).

Shared flags on sources/map/ai-sources/crawlers:
  --release <id>, --start <ISO>, --end <ISO>, --limit <n>
  sources/map also take --offset and the click-filters: --path, --referrer,
  --country, --city, --device, --browser, --os, --language, --utm-source,
  --utm-medium, --utm-campaign (equality; per-event backed, 90-day retention)
  crawlers: --buckets (timeseries), --top-pages-limit (overview)

Examples:
  # Summary KPIs for the last 24h
  remy-admin analytics query '{"metrics":["pageviews","visits","visitors"]}'

  # Top pages, all time
  remy-admin analytics query '{"metrics":["pageviews","visitors"],"dimensions":["path"],"dateRange":"all","limit":10}'

  # Daily views for one post, full history
  remy-admin analytics query '{"metrics":["pageviews"],"dimensions":["time"],"granularity":"day","filters":[["is","path",["/post/hello"]]],"dateRange":"all"}'

  # Summary KPIs + top pages in one round trip
  remy-admin analytics batch '[{"metrics":["pageviews","visits","visitors"]},{"metrics":["pageviews"],"dimensions":["path"],"limit":10}]'

  # Custom-event breakdown over 30 days
  remy-admin analytics query '{"metrics":["events","visitors"],"dimensions":["eventName"],"dateRange":"30d"}'

  # Mobile traffic by country (cross-dimension -> 90-day window)
  remy-admin analytics query '{"metrics":["pageviews"],"dimensions":["country"],"filters":[["is","deviceType",["mobile"]]],"dateRange":"30d"}'

  remy-admin analytics sources --limit 10
  remy-admin analytics live
  remy-admin analytics crawlers recent`;
