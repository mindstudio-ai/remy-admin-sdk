/**
 * CLI skin for the `diagnostics` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/diagnostics.js (pure, typed); response
 * shapes in ../types/diagnostics.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as diagnostics from '../ops/diagnostics.js';
import { out } from '../output.js';
import { sleep } from '../sleep.js';
import type { Handler } from '../types.js';

export const diagnosticsSpecs = {
  'diagnostics get': {
    // `--release` picks which release to read, it is not a query param.
    usage:
      'Usage: remy-admin diagnostics get [--release <id>] [--wait] [--timeout 120]',
    flags: {
      release: { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'number', min: 1 },
    },
  },
  'diagnostics report': {
    usage: 'Usage: remy-admin diagnostics report [--release <id>]',
    flags: { release: { type: 'string' } },
  },
} satisfies Record<string, CommandSpec>;

// Diagnostics are written asynchronously ~30-60s after a release goes live, so a
// freshly-deployed release has no row yet. This is the shape we print in that
// window (and on --wait timeout) so the caller knows to retry.
const DIAGNOSTICS_PENDING = {
  status: 'pending',
  message:
    'Diagnostics run ~30–60s after go-live — not ready yet; retry shortly or pass --wait.',
};
/**
 * Resolve a release id from `--release <id>`, else the current live release
 * (same source as `releases current`). Fatals if neither is available.
 */
async function resolveReleaseId(ctx: AdminContext, a: Args): Promise<string> {
  const flag = a.str('release');
  if (flag) {
    return flag;
  }
  const releaseId = await diagnostics.getLiveReleaseId(ctx);
  if (!releaseId) {
    fatal('No live release — deploy first, or pass --release <id>.');
  }
  return releaseId;
}
// Print the diagnostics for a release: Lighthouse scores, runtime findings
// (console errors + failed requests), the distilled failing-audit summary, and a
// fresh signed URL to the raw report (re-minted by the release GET each call).
async function diagnosticsGet(ctx: AdminContext, a: Args) {
  const releaseId = await resolveReleaseId(ctx, a);

  if (a.bool('wait')) {
    const timeout = (a.num('timeout') ?? 120) * 1000;
    const start = Date.now();
    // Poll until a diagnostics row lands (success or error is terminal).
    while (true) {
      const release = await diagnostics.getRelease(ctx, releaseId);
      if (release.diagnostics) {
        out(release.diagnostics);
        return;
      }
      if (Date.now() - start > timeout) {
        out(DIAGNOSTICS_PENDING);
        return;
      }
      await sleep(3000);
    }
  }

  const release = await diagnostics.getRelease(ctx, releaseId);
  out(release.diagnostics ?? DIAGNOSTICS_PENDING);
}
// Fetch + print the raw Lighthouse JSON report for a release (one command → full
// report). Pulls the signed URL off the release's diagnostics, then GETs it.
async function diagnosticsReport(ctx: AdminContext, a: Args) {
  const releaseId = await resolveReleaseId(ctx, a);
  const release = await diagnostics.getRelease(ctx, releaseId);
  const url = release.diagnostics?.lighthouseJsonUrl;
  if (!url) {
    out(DIAGNOSTICS_PENDING);
    return;
  }
  out(await diagnostics.fetchReport(url));
}

export const diagnosticsHandlers = {
  'diagnostics get': diagnosticsGet,
  'diagnostics report': diagnosticsReport,
} satisfies Record<keyof typeof diagnosticsSpecs, Handler>;

export const diagnosticsHelp = `remy-admin diagnostics — Post-deploy Lighthouse audit.

Every live deploy runs a headless-Chrome audit of the app: Lighthouse scores
(performance, accessibility, best-practices, SEO), runtime findings (console
errors + failed network requests), a distilled list of the failing audits, and
a signed URL to the full raw report.

Subcommands:
  get       Scores + runtime findings + failing-audit summary + a fresh signed
            report URL (the actionable overview)
  report    Fetch and print the raw Lighthouse JSON report (full drill-down)

Usage:
  remy-admin diagnostics get [--release <id>] [--wait] [--timeout 120]
  remy-admin diagnostics report [--release <id>]

Both default to the current live release; pass --release <id> for a specific one.

Notes:
  - The audit runs ASYNCHRONOUSLY, ~30–60s AFTER a release goes live. Right after
    a deploy it won't be ready — 'get' returns {"status":"pending"}. Retry in a
    bit, or use 'get --wait' to block until it lands (default --timeout 120s).
  - The report URL is signed and short-lived; re-run the command to get a fresh
    one rather than reusing an old URL.
  - Diagnostics are produced for live releases only.

Examples:
  remy-admin diagnostics get
  remy-admin diagnostics get --wait
  remy-admin diagnostics get --release rel_abc123
  remy-admin diagnostics report`;
