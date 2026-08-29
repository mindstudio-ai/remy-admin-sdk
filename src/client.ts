/**
 * The importable admin client: every CLI command as a typed method, bound to
 * one app. Namespaces mirror the CLI groups 1:1 — `remy-admin requests list`
 * is `admin.requests.list(...)` — so there is exactly one mental model.
 *
 * The client is a thin binding layer: each namespace is its ops module with
 * the AdminContext pre-applied. Ops throw AdminApiError / AdminTimeoutError;
 * nothing here prints, exits, or streams (the CLI-only streaming passthroughs
 * live in cliStream.ts and are deliberately not exposed).
 */

import {
  DEFAULT_BASE_URL,
  loadWorkspaceAppId,
  type AdminContext,
} from './ctx.js';

import * as analytics from './ops/analytics.js';
import * as crashes from './ops/crashes.js';
import * as cron from './ops/cron.js';
import * as data from './ops/data.js';
import * as dataSources from './ops/dataSources.js';
import * as db from './ops/db.js';
import * as diagnostics from './ops/diagnostics.js';
import * as domains from './ops/domains.js';
import * as email from './ops/email.js';
import * as files from './ops/files.js';
import * as issues from './ops/issues.js';
import * as jewels from './ops/jewels.js';
import * as methods from './ops/methods.js';
import * as prerender from './ops/prerender.js';
import * as releases from './ops/releases.js';
import * as requests from './ops/requests.js';
import * as secrets from './ops/secrets.js';
import * as settings from './ops/settings.js';
import * as users from './ops/users.js';
import * as voice from './ops/voice.js';

export interface AdminClientOptions {
  /** Org-scoped `sk_` API key. Falls back to MINDSTUDIO_API_KEY. */
  apiKey?: string;
  /**
   * The app to manage. Falls back to the workspace's mindstudio.json —
   * pass explicitly anywhere that file doesn't exist.
   */
  appId?: string;
  /** API origin. Falls back to API_BASE_URL, then the production default. */
  baseUrl?: string;
}

/** An ops module with the AdminContext pre-applied to every function. */
type BoundOps<T> = {
  [
    K in keyof T as T[K] extends (
      ctx: AdminContext,
      ...args: never[]
    ) => unknown
      ? K
      : never
  ]: T[K] extends (ctx: AdminContext, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

function bindOps<T extends object>(ops: T, ctx: AdminContext): BoundOps<T> {
  const bound: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(ops)) {
    if (typeof value === 'function') {
      bound[name] = (...args: unknown[]) => value(ctx, ...args);
    }
  }
  return bound as BoundOps<T>;
}

function resolveOptions(options: AdminClientOptions): AdminContext {
  const apiKey = options.apiKey ?? process.env['MINDSTUDIO_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error(
      'No API key: pass { apiKey } to createAdminClient or set MINDSTUDIO_API_KEY',
    );
  }
  return {
    apiKey,
    // loadWorkspaceAppId throws its own precise message if there's no
    // mindstudio.json to fall back to.
    appId: options.appId ?? loadWorkspaceAppId(),
    baseUrl: options.baseUrl ?? process.env['API_BASE_URL'] ?? DEFAULT_BASE_URL,
  };
}

function buildClient(ctx: AdminContext) {
  return {
    /** The resolved context this client is bound to. */
    context: ctx as Readonly<AdminContext>,
    /** A sibling client for another app, sharing credentials. */
    forApp(appId: string) {
      return buildClient({ ...ctx, appId });
    },

    analytics: bindOps(analytics, ctx),
    crashes: bindOps(crashes, ctx),
    cron: bindOps(cron, ctx),
    data: bindOps(data, ctx),
    dataSources: bindOps(dataSources, ctx),
    db: bindOps(db, ctx),
    diagnostics: bindOps(diagnostics, ctx),
    domains: bindOps(domains, ctx),
    email: {
      ...bindOps(email, ctx),
      // Hand-bound: these are generic over the direction ('sending' |
      // 'inbound') and bindOps' mapped type would erase the generic,
      // collapsing every result to the cross-direction union.
      listDomains: <D extends email.DomainDirection>(direction: D) =>
        email.listDomains(ctx, direction),
      checkDomain: <D extends email.DomainDirection>(
        direction: D,
        domain: string,
      ) => email.checkDomain(ctx, direction, domain),
      addDomain: <D extends email.DomainDirection>(
        direction: D,
        domain: string,
      ) => email.addDomain(ctx, direction, domain),
      verifyDomain: <D extends email.DomainDirection>(
        direction: D,
        domain: string,
      ) => email.verifyDomain(ctx, direction, domain),
      removeDomain: <D extends email.DomainDirection>(
        direction: D,
        domain: string,
      ) => email.removeDomain(ctx, direction, domain),
    },
    files: bindOps(files, ctx),
    issues: bindOps(issues, ctx),
    jewels: bindOps(jewels, ctx),
    methods: bindOps(methods, ctx),
    prerender: bindOps(prerender, ctx),
    releases: bindOps(releases, ctx),
    requests: bindOps(requests, ctx),
    secrets: bindOps(secrets, ctx),
    settings: bindOps(settings, ctx),
    users: bindOps(users, ctx),
    voice: bindOps(voice, ctx),
  };
}

export type AdminClient = ReturnType<typeof buildClient>;

/**
 * Create a client bound to one app.
 *
 * ```ts
 * import { createAdminClient } from '@madewithremy/admin';
 * const admin = createAdminClient({ apiKey: 'sk_…', appId: 'app_…' });
 * const { releases } = await admin.releases.list({ limit: 5 });
 * ```
 */
export function createAdminClient(
  options: AdminClientOptions = {},
): AdminClient {
  return buildClient(resolveOptions(options));
}
