/**
 * Local-environment locations for the commands that touch the box rather than
 * the management API: the workspace (files put/get, datasources add, releases
 * wait's git HEAD sniff) and the sandbox sidecar (qa-recordings export). API
 * credentials and appId resolution live in ctx.ts.
 */

// The dev box sets `WORKSPACE_DIR`, so the fallback is only reached outside one. It names the box's
// own layout rather than a stale provider path so that a caller without the env var lands somewhere
// recognisable instead of on a directory that has not existed for two sandbox generations.
export const WORKSPACE_DIR =
  process.env['WORKSPACE_DIR'] || '/home/remy/workspace';

// The sandbox's local sidecar, on a fixed port started by the sandbox
// supervisor (mindstudio-sandbox/src/index.ts). Only `qa-recordings export` uses
// it — the one operation needing the dev box's headless Chrome and ffmpeg
// rather than the management API. Nothing answering is what running outside a
// sandbox looks like, and that command says so.
export const SIDECAR_URL =
  process.env['REMY_SIDECAR_URL'] || 'http://127.0.0.1:4388';
