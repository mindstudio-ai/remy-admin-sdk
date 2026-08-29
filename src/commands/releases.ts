/**
 * CLI skin for the `releases` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/releases.js (pure, typed); response
 * shapes in ../types/releases.js.
 *
 * CLI skin retains: git HEAD sniffing + SHA expansion (workspace concerns),
 * the outcome→exit-code mapping for `wait` (0–4), and the status --wait poll.
 */

import { execFileSync } from 'node:child_process';
import { type Args, type CommandSpec } from '../args.js';
import { WORKSPACE_DIR } from '../config.js';
import type { AdminContext } from '../ctx.js';
import { EXIT, fatal } from '../errors.js';
import * as releases from '../ops/releases.js';
import { out, progress } from '../output.js';
import { sleep } from '../sleep.js';
import type { Handler } from '../types.js';

export const releasesSpecs = {
  'releases list': {
    usage: 'Usage: remy-admin releases list [--limit 20]',
    flags: { limit: { type: 'number', min: 1, max: 100 } },
  },
  'releases get': {
    usage: 'Usage: remy-admin releases get <releaseId>',
    positionals: [{ name: 'releaseId', required: true }],
  },
  'releases current': {
    usage: 'Usage: remy-admin releases current',
  },
  'releases status': {
    usage:
      'Usage: remy-admin releases status <releaseId> [--wait] [--timeout 120]',
    positionals: [{ name: 'releaseId', required: true }],
    flags: { wait: { type: 'boolean' }, timeout: { type: 'number', min: 1 } },
  },
  'releases wait': {
    usage: 'Usage: remy-admin releases wait [--commit <sha>] [--timeout 300]',
    flags: {
      commit: { type: 'string' },
      timeout: { type: 'number', min: 1 },
    },
  },
} satisfies Record<string, CommandSpec>;

/** Current HEAD commit SHA in the workspace, or null if git isn't resolvable. */
function gitHeadSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: WORKSPACE_DIR,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}
/**
 * Best-effort expansion of an abbreviated SHA to the full 40-hex via the
 * workspace repo. Falls back to the input untouched — the object may live
 * only on the server (e.g. a SHA copied from another clone's push output),
 * and the API accepts short SHAs by prefix, so this is an optimization for
 * exactness, not a requirement.
 */
function expandCommitSha(sha: string): string {
  if (sha.length === 40) {
    return sha;
  }
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
      cwd: WORKSPACE_DIR,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return sha;
  }
}
/** Print the final wait result and set the process exit code (no truncation). */
function finishWait(data: unknown, code: number): void {
  out(data);
  process.exitCode = code;
}

async function releasesList(ctx: AdminContext, a: Args) {
  // Newest-first, non-dev releases. `--limit` is honored via the paginated
  // releases endpoint (default 20, max 100) — the dashboard's release list is
  // hardcoded to 10 and ignores a limit, which is why callers that passed
  // `--limit 1` silently got the full set.
  const result = await releases.list(ctx, { limit: a.num('limit') });
  out(result.releases ?? []);
}
async function releasesGet(ctx: AdminContext, a: Args) {
  out(await releases.get(ctx, a.req('releaseId')));
}
async function releasesCurrent(ctx: AdminContext) {
  const live = await releases.dashboardLive(ctx);
  if (!live) {
    fatal('No live release — publish first.');
  }
  out(live);
}
async function releasesStatus(ctx: AdminContext, a: Args) {
  const releaseId = a.req('releaseId');
  const wait = a.bool('wait');
  const timeout = (a.num('timeout') ?? 120) * 1000;
  const startTime = Date.now();

  // Terminal statuses — anything that isn't actively building/compiling
  const TERMINAL = new Set([
    'live',
    'compiled',
    'preview',
    'failed',
    'superseded',
  ]);

  if (!wait) {
    out(await releases.get(ctx, releaseId));
    return;
  }

  // Poll silently, only print the final result
  while (true) {
    const release = await releases.get(ctx, releaseId);

    if (TERMINAL.has(release.status)) {
      out(release);
      return;
    }

    if (Date.now() - startTime > timeout) {
      fatal(`Timed out waiting for release ${releaseId} (${timeout / 1000}s)`);
    }

    await sleep(3000);
  }
}
/**
 * Wait for the release built from a git commit to reach a terminal state.
 *
 * This is the "publish and wait until live" primitive: after `git push`, a
 * caller has a commit SHA (not a release id), so we resolve the release by
 * commit, then poll until it goes live / fails / times out — reporting the
 * verdict via the exit code so the caller never has to scrape output.
 *
 * `--commit` defaults to the workspace's HEAD. Success is `live` (default
 * branch) or `preview` (feature branch); `failed`/`superseded` and timeout
 * each get their own exit code.
 */
async function releasesWait(ctx: AdminContext, a: Args) {
  const rawCommit = a.str('commit') ?? gitHeadSha();
  if (!rawCommit) {
    fatal(
      'Could not determine commit SHA — pass --commit <sha> or run inside the app git repo',
    );
  }
  // Fail fast on a non-SHA instead of burning the 30s resolve window on a
  // value the API would never match (it 400s on non-hex anyway).
  if (!/^[0-9a-f]{7,40}$/i.test(rawCommit)) {
    fatal(
      `--commit must be a 7-40 character hex commit SHA (got ${JSON.stringify(rawCommit)})`,
    );
  }
  const commit = expandCommitSha(rawCommit);
  const timeoutMs = (a.num('timeout') ?? 300) * 1000;

  const result = await releases.waitForCommit(ctx, {
    commitSha: commit,
    timeoutMs,
    onProgress: progress,
  });

  switch (result.outcome) {
    case 'not_found':
      finishWait(
        {
          status: 'not_found',
          commitSha: commit,
          error: result.error,
        },
        EXIT.notFound,
      );
      return;
    case 'timeout':
      finishWait(
        {
          ...result.summary,
          error: result.error,
        },
        EXIT.timeout,
      );
      return;
    case 'live':
    case 'preview':
      finishWait(result.summary, EXIT.ok);
      return;
    case 'failed':
      finishWait(result.summary, EXIT.buildFailed);
      return;
    case 'superseded':
      finishWait(result.summary, EXIT.superseded);
      return;
  }
}

export const releasesHandlers = {
  'releases list': releasesList,
  'releases get': releasesGet,
  'releases current': releasesCurrent,
  'releases status': releasesStatus,
  'releases wait': releasesWait,
} satisfies Record<keyof typeof releasesSpecs, Handler>;

export const releasesHelp = `remy-admin releases — View and monitor releases.

Subcommands:
  list      List releases, newest first (--limit N, default 20, max 100)
  get       Get full details of a specific release
  current   Get the currently live release
  status    Check a release's status by id (optionally poll until complete)
  wait      Wait for the release built from a commit to go live

Usage:
  remy-admin releases list [--limit 20]
  remy-admin releases get <releaseId>
  remy-admin releases current
  remy-admin releases status <releaseId> [--wait] [--timeout 120]
  remy-admin releases wait [--commit <sha>] [--timeout 300]

'releases wait' is the "publish and wait until live" primitive. After a
'git push', run it to block until the pushed commit's release is terminal.
A push to a non-default branch resolves to status 'preview' and the result
carries 'previewUrl' — the gated URL that build is reachable at.
--commit defaults to the workspace HEAD; abbreviated SHAs (7+ hex chars,
e.g. from push output) are accepted. It prints one JSON object and sets
the exit code so you can branch on $? without parsing:
  0  live (deployed)        2  timed out (still building)   4  superseded
  1  build failed           3  no release found for commit
Any other failure (bad arguments, auth, API error) exits 10, so exit 1 always
means the build itself failed.

Examples:
  git push origin HEAD && remy-admin releases wait
  remy-admin releases wait --commit 91ca67a --timeout 600
  remy-admin releases list --limit 1`;
