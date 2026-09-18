/**
 * remy-admin — CLI for managing production Remy apps.
 * (The published bin's shebang is injected by the tsup banner.)
 *
 * Designed to be invoked by remy via its bash tool. Output is one JSON value
 * per line — compact when stdout is a pipe, pretty-printed on a TTY. Help text
 * is plain text so remy can discover capabilities via `remy-admin --help`.
 *
 * Exit codes: 0 success, 10 any error. `releases wait` additionally uses 1-4
 * for build outcomes (see the releases help text).
 *
 * Config is read from environment variables (MINDSTUDIO_API_KEY,
 * API_BASE_URL) and the workspace's mindstudio.json (for appId).
 *
 * This file is only the wiring. Commands live in ./commands/, one file per
 * group, each owning its spec, handlers, and help text.
 */

import { parseCommand } from './args.js';
import { HANDLERS, SPECS } from './commands/index.js';
import { DEFAULT_BASE_URL, loadWorkspaceAppId } from './ctx.js';
import { CliError, EXIT, fatal } from './errors.js';
import { out } from './output.js';
import { resolveHelp, resolveRoute } from './routing.js';

async function main() {
  const argv = process.argv.slice(2);

  // Help first: plain text, and must work with no env and no workspace.
  const help = resolveHelp(argv);
  if (help) {
    console.log(help);
    return;
  }

  // Then routing and argument validation — both before touching config, so an
  // unknown command or a missing argument reports itself instead of being
  // masked by "MINDSTUDIO_API_KEY is not set".
  const route = resolveRoute(argv);
  if ('error' in route) {
    fatal(route.error);
  }
  const a = parseCommand(SPECS[route.key], route.argv);

  const apiKey = process.env['MINDSTUDIO_API_KEY'] ?? '';
  if (!apiKey) {
    fatal('MINDSTUDIO_API_KEY environment variable is not set');
  }
  // `--app` targets another app in the workspace. Read generically: `str` on a
  // flag the command didn't declare returns undefined, so only the commands
  // that spread in APP can actually be redirected. It is also the one way to
  // run outside a workspace, where loadWorkspaceAppId() throws — hence the
  // short-circuit rather than `?? loadWorkspaceAppId()`.
  const appIdOverride = a.str('app');
  // Retargeting at another app makes THIS workspace's app the actor, so writes
  // can record who filed. Resolved here rather than at the call site because
  // this is the only place that knows both ends. Outside a workspace there is
  // no origin to claim, and no `--app` means we are not acting on anyone's
  // behalf but our own — both leave it undefined.
  let originAppId: string | undefined;
  if (appIdOverride) {
    try {
      const workspaceAppId = loadWorkspaceAppId();
      if (workspaceAppId !== appIdOverride) {
        originAppId = workspaceAppId;
      }
    } catch {
      // No workspace (a laptop, CI) — `--app` is the only app in play.
    }
  }
  const ctx = {
    apiKey,
    appId: appIdOverride ?? loadWorkspaceAppId(),
    originAppId,
    baseUrl: process.env['API_BASE_URL'] || DEFAULT_BASE_URL,
  };

  return HANDLERS[route.key](ctx, a);
}

main().catch((err) => {
  out({ error: err?.message ?? String(err) });
  process.exitCode = err instanceof CliError ? err.code : EXIT.generic;
});
