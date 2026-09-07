/**
 * S3 connectors: make a bucket the customer owns the origin of a data source,
 * and keep the source in sync with it.
 *
 * Ops are pure (ctx, params) → typed result. The CLI skin in
 * commands/dataSourceConnectors.ts owns flags, progress and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs } from '../http.js';
import type {
  DataSourceConnectorDeletions,
  DataSourceConnectorGetResult,
  DataSourceConnectorResult,
  DataSourceSyncResult,
} from '../types/dataSourceConnectors.js';

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/datasources`;
}

// ─── connect ─────────────────────────────────────────────────────────────────

export interface ConnectParams {
  /** Data source slug. Created on first use, like `add`. */
  slug: string;
  bucket: string;
  /** AWS region of the bucket, e.g. `us-east-1`. */
  region: string;
  /** Key prefix to follow; omit for the whole bucket. */
  prefix?: string;
  /** S3-compatible endpoint (https; http for localhost). Omit for AWS. */
  endpoint?: string;
  /** NAME of the app secret holding the access key id. */
  accessKeyIdSecret: string;
  /** NAME of the app secret holding the secret access key. */
  secretAccessKeySecret: string;
  /** Default `mirror`. */
  deletions?: DataSourceConnectorDeletions;
  /** Ceiling a sync auto-approves under. */
  budgetDollarsPerSync?: number;
}

/**
 * Connect a source to a bucket. The two secrets must already exist on the app
 * (`secrets set`), and the keys must be able to list the prefix — both are
 * checked before anything is recorded. Calling again with the same bucket,
 * region, prefix and endpoint updates credentials and policy in place; a
 * different origin is refused until the source is disconnected.
 *
 * @throws AdminApiError `invalid_connector` (400), `connector_secret_missing`
 *   (422), `connector_probe_failed` (422), `connector_exists` (422).
 * @example
 * await admin.dataSourceConnectors.connect({
 *   slug: 'archive', bucket: 'acme-docs', region: 'us-east-1', prefix: 'contracts/',
 *   accessKeyIdSecret: 'ARCHIVE_S3_KEY', secretAccessKeySecret: 'ARCHIVE_S3_SECRET',
 * });
 */
export function connect(ctx: AdminContext, params: ConnectParams) {
  const {
    slug,
    bucket,
    region,
    prefix,
    endpoint,
    accessKeyIdSecret,
    secretAccessKeySecret,
    deletions,
    budgetDollarsPerSync,
  } = params;
  return call<DataSourceConnectorResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/connector`,
    {
      slug,
      bucket,
      region,
      ...(prefix !== undefined ? { prefix } : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
      accessKeyIdSecret,
      secretAccessKeySecret,
      ...(deletions !== undefined ? { deletions } : {}),
      ...(budgetDollarsPerSync !== undefined ? { budgetDollarsPerSync } : {}),
    },
  );
}

// ─── read ────────────────────────────────────────────────────────────────────

/** The source's connector with its object counts, or `connector: null`. */
export function get(ctx: AdminContext, params: { slug: string }) {
  return call<DataSourceConnectorGetResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/connector${qs({ slug: params.slug })}`,
  );
}

// ─── disconnect ──────────────────────────────────────────────────────────────

/**
 * Stop following the bucket. The documents stay; only the connector and its
 * object index go.
 *
 * @throws AdminApiError `connector_not_found` (422), `data_source_busy` (422)
 *   while a job is in flight.
 */
export function disconnect(ctx: AdminContext, params: { slug: string }) {
  return call<DataSourceConnectorResult & { removed: true }>(
    ctx,
    'POST',
    `${base(ctx.appId)}/connector/remove`,
    { slug: params.slug },
  );
}

// ─── sync ────────────────────────────────────────────────────────────────────

export interface SyncParams {
  slug: string;
  /** Override the connector's per-sync budget for this run, in dollars. */
  budgetDollars?: number;
}

/**
 * Start a sync: list the bucket, diff by ETag, run a job over what changed.
 * Auto-approved under the connector's per-sync budget; a plan over it (or over
 * the placement's capacity) waits in `planned` for `dataSourceJobs.approve`.
 * Block on the result with `dataSourceJobs.waitForJob`.
 *
 * @throws AdminApiError `connector_not_found` (422), `data_source_busy` (422).
 */
export function sync(ctx: AdminContext, params: SyncParams) {
  return call<DataSourceSyncResult>(ctx, 'POST', `${base(ctx.appId)}/sync`, {
    slug: params.slug,
    ...(params.budgetDollars !== undefined
      ? { budgetDollars: params.budgetDollars }
      : {}),
  });
}
