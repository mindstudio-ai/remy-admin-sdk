/**
 * The bound context every operation runs against: which app, as whom, where.
 *
 * Ops in src/ops/ take this as their first argument and are otherwise pure —
 * no env reads, no process coupling — so the same functions serve both the
 * CLI (context from the environment, built once in prod.ts) and the importable
 * client (context from createAdminClient's options).
 */

import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR } from './config.js';
import { parseJsonConfig } from './parseJsonConfig.js';

export interface AdminContext {
  /** Org-scoped `sk_` API key. */
  apiKey: string;
  /** The app every operation is scoped to. */
  appId: string;
  /**
   * Who is acting, when that is not `appId` itself — set only when the caller
   * has retargeted at another app (`--app`, or `forApp()`), and carrying the
   * app they came FROM.
   *
   * Writes that record authorship attach it, so a cross-app issue says which
   * app filed it without the caller having to remember a second flag. That
   * matters more than it sounds: the information was always available here and
   * being optional at the call site is precisely how it came to be omitted
   * everywhere.
   */
  originAppId?: string;
  /** API origin, no trailing slash. */
  baseUrl: string;
}

export const DEFAULT_BASE_URL = 'https://api.mindstudio.ai';

/**
 * Resolve the appId the way the CLI always has: `mindstudio.json` in the
 * workspace. Throws a plain Error with the CLI's historical message text —
 * prod.ts's catch turns it into `{error}` + exit 10, and the client surfaces
 * it as-is.
 */
export function loadWorkspaceAppId(workspaceDir = WORKSPACE_DIR): string {
  const manifestPath = path.join(workspaceDir, 'mindstudio.json');
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`mindstudio.json not found at ${manifestPath}`);
    }
    throw new Error(`Failed to read mindstudio.json: ${err.message}`);
  }
  // Tolerant parse, but deliberately read-only: this is a short-lived process
  // and shouldn't mutate the workspace out from under the running sandbox.
  const result = parseJsonConfig<{ appId?: string }>(raw);
  if (!result.ok) {
    throw new Error(`Failed to parse mindstudio.json: ${result.error}`);
  }
  if (!result.value.appId) {
    throw new Error('mindstudio.json exists but has no appId');
  }
  return result.value.appId;
}
