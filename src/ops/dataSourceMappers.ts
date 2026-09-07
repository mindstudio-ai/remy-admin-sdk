/**
 * Data-source mappers: the loop around customer code that turns raw objects
 * into documents — inspect the objects, test the mapper, make a build's mapper
 * the source's active one, remap after a fix, read and replay what a job
 * quarantined.
 *
 * Ops are pure (ctx, params) → typed result. The CLI skin in
 * commands/dataSourceMappers.ts owns flags, progress and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import type {
  DataSourceInspectResult,
  DataSourceMapDeployResult,
  DataSourceMapTestResult,
  DataSourceQuarantineResult,
  DataSourceRemapResult,
} from '../types/dataSourceMappers.js';

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/datasources`;
}

/** Which objects to look at: a prefix of an app file store, or the connected bucket. */
export type ObjectSelection =
  | { store: string; access?: 'private' | 'public'; prefix?: string }
  | { connector: true };

function selectionBody(selection: ObjectSelection): Record<string, unknown> {
  if ('connector' in selection) {
    return { connector: true };
  }
  return {
    store: selection.store,
    ...(selection.access ? { access: selection.access } : {}),
    ...(selection.prefix !== undefined ? { prefix: selection.prefix } : {}),
  };
}

// ─── inspect ─────────────────────────────────────────────────────────────────

export interface InspectParams {
  /** Required for a connector selection; optional for a store. */
  slug?: string;
  selection: ObjectSelection;
  /** Only these keys. */
  keys?: string[];
  /** Objects to list (default 5,000, max 50,000). */
  limit?: number;
}

/**
 * Profile raw objects before writing a mapper: counts and bytes by extension
 * and by key shape, size buckets, and ten sampled heads with their JSON key
 * signatures. Read-only.
 *
 * @throws AdminApiError `invalid_source` (400), `connector_not_found` (422).
 */
export function inspect(ctx: AdminContext, params: InspectParams) {
  return call<DataSourceInspectResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/inspect`,
    {
      ...(params.slug ? { slug: params.slug } : {}),
      ...selectionBody(params.selection),
      ...(params.keys ? { keys: params.keys } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    },
  );
}

// ─── map test ────────────────────────────────────────────────────────────────

export interface MapTestParams {
  slug: string;
  selection: ObjectSelection;
  keys?: string[];
  /** Objects to map (default 20, max 200). */
  limit?: number;
  /** Run the LOCAL mapper through the app's dev session instead of the live bundle. */
  dev?: boolean;
}

/**
 * Run the source's mapper over real objects and return the outcomes — nothing
 * is ingested. With `dev` the mapper runs from local source through the
 * running dev session, which is how a mapper is checked before a deploy.
 *
 * @throws AdminApiError `no_mapper` (422), `no_dev_session` (422),
 *   `invalid_source` (400).
 */
export function mapTest(ctx: AdminContext, params: MapTestParams) {
  return call<DataSourceMapTestResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/map-test`,
    {
      slug: params.slug,
      ...selectionBody(params.selection),
      ...(params.keys ? { keys: params.keys } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.dev ? { dev: true } : {}),
    },
  );
}

// ─── remap ───────────────────────────────────────────────────────────────────

export interface RemapParams {
  slug: string;
  /** Pause when estimated spend reaches this; default the plan's headroom. */
  budgetDollars?: number;
  /** Only the first N raw objects. */
  limit?: number;
}

// ─── deploy ──────────────────────────────────────────────────────────────────

export interface MapDeployParams {
  slug: string;
  /**
   * The release to take the mapper from. Default: the newest built release —
   * live or the head of any branch — that carries a compiled mapper for the
   * slug.
   */
  releaseId?: string;
}

/**
 * Make a built release's compiled mapper the source's active mapper — what
 * jobs, syncs and `add()` run from now on. A branch build is enough: the app
 * need never have been published. Publishing to main also activates the
 * mapper main declares. Idempotent (`changed: false` when already active).
 *
 * @throws AdminApiError `no_built_mapper` (422) when no build carries a
 *   compiled mapper for the slug, `release_not_found` (404).
 */
export function mapDeploy(ctx: AdminContext, params: MapDeployParams) {
  return call<DataSourceMapDeployResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/mapper/deploy`,
    {
      slug: params.slug,
      ...(params.releaseId ? { releaseId: params.releaseId } : {}),
    },
  );
}

/**
 * Run the active mapper over every raw object the source holds a copy of.
 * Auto-approved: unchanged markdown is skipped by hash, so a remap after a
 * metadata tweak costs frames and little else. Block on the job with
 * `dataSourceJobs.waitForJob`.
 *
 * @throws AdminApiError `no_mapper` (422), `nothing_to_remap` (422),
 *   `data_source_busy` (422).
 */
export function remap(ctx: AdminContext, params: RemapParams) {
  return call<DataSourceRemapResult>(ctx, 'POST', `${base(ctx.appId)}/remap`, {
    slug: params.slug,
    ...(params.budgetDollars !== undefined
      ? { budgetDollars: params.budgetDollars }
      : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });
}

// ─── quarantine + replay ─────────────────────────────────────────────────────

export interface QuarantineParams {
  id: string;
  kind?: 'skip' | 'error';
  /** Only objects quarantined with exactly this reason. */
  reason?: string;
  cursor?: string;
  /** Page size (default 100, max 1,000). */
  limit?: number;
}

/**
 * What a job's mapper skipped or failed on: counts, reasons by frequency, and
 * a page of objects.
 *
 * @throws AdminApiError `job_not_found` (404).
 */
export function quarantine(ctx: AdminContext, params: QuarantineParams) {
  return call<DataSourceQuarantineResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/jobs/${params.id}/quarantine${qs({
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    })}`,
  );
}

export interface ReplayParams {
  id: string;
  kind?: 'skip' | 'error';
}

/**
 * Run a job's quarantined objects through the current mapper, from their raw
 * copies. Starts a job; block on it with `dataSourceJobs.waitForJob`.
 *
 * @throws AdminApiError `nothing_to_replay` (422), `no_mapper` (422),
 *   `data_source_busy` (422).
 */
export function replay(ctx: AdminContext, params: ReplayParams) {
  return call<DataSourceRemapResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/jobs/${params.id}/replay`,
    params.kind ? { kind: params.kind } : {},
  );
}
