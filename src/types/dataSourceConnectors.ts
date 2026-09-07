/**
 * Response types for S3 connectors on data sources.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/dataSourceConnectors.ts (connectorView)
 *   src/common/Db/v2Apps/V2DataSourceConnectorsDao.ts
 */

import type { DataSourceJob } from './dataSourceJobs.js';

/**
 * What to do when a key disappears from the bucket. `mirror`: its document is
 * removed at the end of the next full sync. `keep`: the document stays.
 */
export type DataSourceConnectorDeletions = 'mirror' | 'keep';

export interface DataSourceConnectorPolicy {
  deletions: DataSourceConnectorDeletions;
  /** Ceiling a sync auto-approves under; null = the plan's own 1.5× headroom. */
  budgetDollarsPerSync: number | null;
}

/** App-secret NAMES that hold the keys. Values never leave the platform. */
export interface DataSourceConnectorCredentials {
  accessKeyIdSecret: string;
  secretAccessKeySecret: string;
}

export interface DataSourceConnector {
  id: string;
  type: 's3';
  bucket: string;
  region: string;
  /** Key prefix listed under; '' for the whole bucket. */
  prefix: string;
  /** S3-compatible endpoint, or null for AWS. */
  endpoint: string | null;
  credentials: DataSourceConnectorCredentials;
  policy: DataSourceConnectorPolicy;
  lastSyncJobId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Only on GET: how many customer keys the index tracks. */
  objects?: { live: number; deleted: number };
  createdAt: string;
  updatedAt: string;
}

/** POST /datasources/connector, POST /datasources/connector/remove */
export interface DataSourceConnectorResult {
  connector: DataSourceConnector;
}

/** GET /datasources/connector?slug= */
export interface DataSourceConnectorGetResult {
  connector: DataSourceConnector | null;
}

/** POST /datasources/sync */
export interface DataSourceSyncResult {
  job: DataSourceJob;
}
