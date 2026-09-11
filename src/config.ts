/**
 * Workspace location for CLI commands that touch local files (files put/get,
 * datasources add, releases wait's git HEAD sniff). API credentials and appId
 * resolution live in ctx.ts.
 */

// The dev box sets `WORKSPACE_DIR`, so the fallback is only reached outside one. It names the box's
// own layout rather than a stale provider path so that a caller without the env var lands somewhere
// recognisable instead of on a directory that has not existed for two sandbox generations.
export const WORKSPACE_DIR =
  process.env['WORKSPACE_DIR'] || '/home/remy/workspace';
