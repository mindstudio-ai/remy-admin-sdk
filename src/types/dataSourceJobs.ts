/**
 * Response types for bulk ingestion jobs.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/dataSourceJobs.ts (jobView)
 *   src/common/DataSources/jobs/types.ts
 */

/**
 * Where a job's documents come from. `store` is every object under a prefix of
 * one of the app's file stores (what `files put` fills); `manifest` is a JSONL
 * object the CLI uploaded, one `{ url, filename?, externalId?, metadata? }` per
 * line, for documents that live behind URLs; `connector` is a sync of the S3
 * bucket the source is connected to (`datasources sync`); `remap` runs the
 * live mapper over the source's own raw copies (`datasources remap`); `replay`
 * runs an earlier job's quarantined objects through the current mapper
 * (`datasources jobs replay`).
 */
export type DataSourceJobSource =
  | {
      type: 'store';
      store: string;
      access: 'private' | 'public';
      prefix: string;
    }
  | { type: 'manifest'; key: string }
  | { type: 'connector'; connectorId: string }
  | {
      /** A random draw of another source's documents (`datasources sample`). */
      type: 'sample';
      fromDataSourceId: string;
      size: number;
      filter: Record<string, unknown> | null;
      stratify: string | null;
    }
  | { type: 'remap' }
  | { type: 'replay'; fromJobId: string; kind: 'skip' | 'error' | null };

/**
 * planning → planned → running ⇄ paused → done | failed | cancelled.
 * `planned` waits for `approve` (or was started with `approve: true` and a
 * gate refused; the job's `error` says which).
 */
export type DataSourceJobState =
  | 'planning'
  | 'planned'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

/**
 * What the corpus would cost before any of it is spent. Every number is an
 * extrapolation from a sample of about a hundred objects; credits are ledger
 * credits (nano-dollars) at today's catalog rates.
 */
export interface DataSourceJobPlan {
  objects: number;
  bytes: number;
  sample: {
    documents: number;
    failed: number;
    avgChunks: number;
    avgTokens: number;
    avgPages: number;
    modelExtractionShare: number;
    secondsPerDocument: number;
  };
  /**
   * Mapped sources only: what the mapper did with the sampled objects. The
   * skip share is the baseline the run's skip gate pauses against.
   */
  mapping: {
    objects: number;
    documentsPerObject: number;
    passthroughShare: number;
    skipShare: number;
    errorShare: number;
    deleteShare: number;
    secondsPerObject: number;
  } | null;
  projected: {
    documents: number;
    chunks: number;
    tokens: number;
    points: number;
    artifactBytes: number;
    credits: {
      embedding: number;
      extraction: number;
      contextual: number;
      total: number;
    };
  };
  capacity: {
    placement: 'shared' | 'dedicated';
    resourceId: string | null;
    maxPoints: number;
    heldPoints: number;
    /** False means approve is refused until the source moves or the resource grows. */
    fits: boolean;
  };
  durationMinutes: number;
  warnings: string[];
  computedAt: string;
}

export interface DataSourceJob {
  id: string;
  dataSourceId: string;
  pipelineId: string;
  source: DataSourceJobSource;
  /**
   * Objects the mapper skipped or failed on. Counted on `jobs status`; on the
   * list and on unmapped sources' jobs both are zero.
   */
  quarantine: { skipped: number; errors: number };
  state: DataSourceJobState;
  autoApprove: boolean;
  plan: DataSourceJobPlan | null;
  budgetCredits: number | null;
  budgetDollars: number | null;
  maxInflightBatches: number;
  limitObjects: number | null;
  enumerationDone: boolean;
  counts: {
    /** Keys the planning walk listed, before the change diff: progress, not work. */
    objectsListed: number;
    objectsSeen: number;
    bytesSeen: number;
    objectsDispatched: number;
    documentsDone: number;
    documentsSkipped: number;
    documentsFailed: number;
    chunks: number;
    embedTokens: number;
    extractionPages: number;
  };
  /** Model spend so far at catalog rates — an estimate, not the ledger. */
  estimatedCredits: number;
  estimatedDollars: number;
  /** Recent per-document failures, newest first, at most twenty. */
  samples: { ref: string; message: string; at: string }[];
  error: string | null;
  /**
   * Why a running job stopped: the owner, the budget, repeated batch
   * failures, or (mapped sources) a skip share far above the plan's.
   */
  pauseReason: 'user' | 'budget' | 'errors' | 'skips' | null;
  stalled: boolean;
  /** Times a pause for errors resumed itself on its own schedule. */
  autoResumes: number;
  /** When a pause for errors will next resume itself; null when it waits for you. */
  autoResumeAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastProgressAt: string | null;
}

/** GET /datasources/jobs */
export interface DataSourceJobsListResult {
  jobs: DataSourceJob[];
}

/** GET /datasources/jobs/:id */
export interface DataSourceJobGetResult {
  job: DataSourceJob;
  dataSource: { id: string; slug: string };
  batches: Record<
    'pending' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled',
    number
  >;
}

/** POST /datasources/jobs and the four controls */
export interface DataSourceJobResult {
  job: DataSourceJob;
}

/** POST /datasources/jobs/manifest-token */
export interface DataSourceJobManifestTokenResult {
  key: string;
  upload: {
    key: string;
    uploadUrl: string;
    uploadFields: Record<string, string>;
  };
}
