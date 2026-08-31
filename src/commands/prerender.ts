/**
 * CLI skin for the `prerender` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/prerender.js (pure, typed); response
 * shapes in ../types/prerender.js.
 *
 * CLI skin retains: the crawler-UA fetch of the app's public URL (`get`), which
 * exercises the real serve path rather than the manage API.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../http.js';
import * as prerender from '../ops/prerender.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';
import type { PrerenderGetResult } from '../types/prerender.js';

export const prerenderSpecs = {
  'prerender invalidate': {
    usage:
      'Usage: remy-admin prerender invalidate <path...>   (or --all to purge every snapshot)',
    positionals: [{ name: 'path', variadic: true }],
    flags: { all: { type: 'boolean' } },
    requireAnyOf: {
      flags: ['all'],
      positionals: ['path'],
      message: 'Provide at least one path, or --all to purge every snapshot.',
    },
  },
  'prerender get': {
    usage: 'Usage: remy-admin prerender get <path> [--host <hostname>]',
    positionals: [{ name: 'path', required: true }],
    flags: { host: { type: 'string' } },
  },
  'prerender pages': {
    usage: 'Usage: remy-admin prerender pages [--cursor <c>]',
    flags: { cursor: { type: 'string' } },
  },
  'prerender view': {
    usage: 'Usage: remy-admin prerender view <path>',
    positionals: [{ name: 'path', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function prerenderInvalidate(ctx: AdminContext, a: Args) {
  out(
    await prerender.invalidate(ctx, {
      paths: a.bool('all') ? undefined : a.rest('path'),
    }),
  );
}
// Verify what a crawler actually gets: fetch the app's public URL with a bot
// User-Agent so the origin serves the prerender snapshot branch. Not an authed
// api() call — it hits the public serve path exactly as a crawler would. A cold
// path returns the live SPA (and triggers a render); re-run to see the snapshot.
//
// `--host` exists for mounted pages. When another app mounts this one, the
// snapshot's path carries that mount prefix and the page is only reachable on
// the PARENT's host — the default host below would fetch a 404 on this app's own
// domain and report it as if it were the page.
async function prerenderGet(ctx: AdminContext, a: Args) {
  const rawPath = a.req('path');
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const isDev = !ctx.baseUrl.includes('api.mindstudio.ai');
  const host =
    a
      .str('host')
      ?.replace(/^https?:\/\//, '')
      .replace(/\/+$/, '') ||
    `${ctx.appId}${isDev ? '-dev' : ''}.madewithremy.com`;
  const url = `https://${host}${normalized}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'Twitterbot/1.0 (+remy-admin prerender verify)',
      },
    },
    REQUEST_TIMEOUT_MS,
    `Prerender fetch ${url}`,
  );
  const html = await res.text();
  const result: PrerenderGetResult = { url, status: res.status, html };
  out(result);
}

// The stored-snapshot views, straight off the manage API: what's cached for
// the live release, and the exact HTML of one snapshot. Complements `get`,
// which fetches the public URL as a crawler would (network path included).
async function prerenderPages(ctx: AdminContext, a: Args) {
  out(await prerender.pages(ctx, { cursor: a.str('cursor') }));
}

async function prerenderView(ctx: AdminContext, a: Args) {
  const rawPath = a.req('path');
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  out(await prerender.view(ctx, { path: normalized }));
}

export const prerenderHandlers = {
  'prerender invalidate': prerenderInvalidate,
  'prerender get': prerenderGet,
  'prerender pages': prerenderPages,
  'prerender view': prerenderView,
} satisfies Record<keyof typeof prerenderSpecs, Handler>;

export const prerenderHelp = `remy-admin prerender — Manage prerendered snapshots served to bots/crawlers.

Subcommands:
  pages        List the live release's stored snapshots (path, renderedAt, bytes)
  view         Print one stored snapshot as { path, html }
  invalidate   Purge cached snapshot(s) so crawlers get a fresh render next visit
  get          Fetch a path as a crawler (bot UA) to verify end-to-end

Usage:
  remy-admin prerender pages [--cursor <c>]     Paginated snapshot list
  remy-admin prerender view <path>              The stored HTML for one path
  remy-admin prerender invalidate <path...>     Purge specific paths
  remy-admin prerender invalidate --all         Purge every snapshot for the app
  remy-admin prerender get <path>               Print { url, status, html } as a crawler sees it
  remy-admin prerender get <path> --host <h>    Same, against a specific hostname

Notes:
  - 'pages'/'view' read what's stored for the LIVE release; 'get' exercises the real
    serve path with a bot User-Agent. A warm path returns the snapshot; a cold path
    returns the live SPA and triggers a render — re-run to see it.
  - 'view' errors with snapshot_not_found when the path has no snapshot yet.
  - Invalidation targets the current LIVE release; a deploy already invalidates on its own.
  - Mounted pages: when another app mounts this one, 'pages' lists paths carrying that
    app's mount prefix, and those pages exist only on that app's host — pass --host to
    verify them with 'get'. 'invalidate' takes this app's OWN paths and purges the
    mounted copies with them.

Examples:
  remy-admin prerender pages
  remy-admin prerender view /u/abc123
  remy-admin prerender invalidate --all
  remy-admin prerender get /u/abc123
  remy-admin prerender get /demos/vector-search/blog/x --host example.com`;
