/**
 * Workspace location for CLI commands that touch local files (files put/get,
 * datasources add, releases wait's git HEAD sniff). API credentials and appId
 * resolution live in ctx.ts.
 */

export const WORKSPACE_DIR =
  process.env['WORKSPACE_DIR'] || '/home/vercel-sandbox/workspace';
