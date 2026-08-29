/**
 * Result types for the `jewels` CLI commands.
 *
 * Transcribed from:
 *   youai-api/src/http/routes/V2Apps/manage/jewels.ts
 *   youai-api/src/common/Db/v2Apps/jewels/V2JewelPairsDao.ts
 *   youai-api/src/common/Db/v2Apps/jewels/V2TrainingRunsDao.ts
 *   youai-api/src/common/Db/v2Apps/jewels/V2JewelProposalsDao.ts
 *   youai-api/src/common/Db/v2Apps/jewels/resolveQueueItem.ts
 *   youai-api/src/common/Db/v2Apps/jewels/training.ts
 *   youai-api/src/common/Db/v2Apps/jewels/gradeTrainingRun.ts
 *   youai-api/src/common/Db/v2Apps/jewels/datasetExport.ts
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/**
 * `expired` is platform-assigned only: a pending arrival proposal whose
 * attributionWindow closed with no human action to grade against.
 */
export type JewelVerdict = 'agree' | 'disagree' | 'skip' | 'expired';

export type TrainingRunStatus = 'queued' | 'running' | 'complete' | 'failed';

export type DatasetFile =
  'sft-train' | 'sft-eval' | 'preference' | 'eval-disagreements';

// ---------------------------------------------------------------------------
// Shared row types
// ---------------------------------------------------------------------------

/**
 * Slim pair columns returned by list views — excludes the pair JSONB payload.
 * (V2JewelPairSummary from V2JewelPairsDao)
 */
export interface JewelPairSummaryRow {
  id: string;
  appId: string;
  releaseId: string | null;
  methodId: string;
  mode: string;
  /** null when the run failed before grading. */
  verdict: JewelVerdict | null;
  /** The jewel's reasoning prose, extracted for list views. */
  reasoning: string | null;
  /** 'infra' | 'subject' | 'propose' | null */
  errorPhase: string | null;
  runDurationMs: number | null;
  humanRequestId: string;
  jewelRequestId: string;
  humanUserId: string | null;
  jewelUserId: string | null;
  requestSource: string | null;
  createdAt: string;
}

/**
 * Full pair row — summary columns plus the complete JewelPairRecord.
 * (V2JewelPair from V2JewelPairsDao)
 */
export interface JewelPairRow extends JewelPairSummaryRow {
  /** The full JewelPairRecord (or an infra-error marker). Dynamic model IO. */
  pair: Record<string, any>;
}

/**
 * One entry in a run's append-only event log.
 * 'status' entries narrate the run for humans; 'loss' entries carry the
 * live training curve. (TrainingLogEntry from V2TrainingRunsDao)
 */
export type TrainingLogEntry =
  | {
      ts: number;
      kind: 'status';
      phase: string;
      message: string;
      metadata?: Record<string, any>;
    }
  | { ts: number; kind: 'loss'; step: number; loss: number };

/**
 * Training run row. (V2TrainingRun from V2TrainingRunsDao)
 *
 * `log` is only populated on single-run reads (`jewels run`); list responses
 * serialize it as [].
 */
export interface TrainingRunRow {
  id: string;
  appId: string;
  methodId: string;
  status: TrainingRunStatus;
  baseModel: string;
  /** LoRA/fine-tuning parameters (epochs, rank, learningRate). */
  tuning: Record<string, any>;
  /** Dataset build summary — per-file counts and exclusion buckets. */
  datasetSummary: Record<string, any>;
  datasetPrefix: string;
  adapterKey: string | null;
  /** Dynamic run report (grading, predictions, candidates after completion). */
  report: Record<string, any> | null;
  /**
   * Latest trainer heartbeat (phase/step/loss + a server-stamped `at`);
   * frozen at last value once the run reaches a terminal state.
   */
  progress: Record<string, any> | null;
  /** Append-only event log — only populated on single-run reads. */
  log: TrainingLogEntry[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Grading types
// ---------------------------------------------------------------------------

/**
 * The jewel's own grade results for a run's held-out predictions.
 * agree/(agree+disagree) matches the pairs dashboard's agreement formula.
 * (TrainingRunGrading from gradeTrainingRun.ts)
 */
export interface JewelsGrading {
  /** agree / (agree + disagree) — skips and ungraded excluded, like the ledger. */
  agreement: number | null;
  agree: number;
  disagree: number;
  skip: number;
  /** Rows the grader could not judge (infra failures). */
  ungraded: number;
  /** Whether any row dispatched the jewel's custom grade function (vs deep-equal). */
  customGrade: boolean;
  gradedAt: string;
  infraErrors?: string[];
  /** The untrained base's agreement on the same held-out set (lift baseline). */
  baseAgreement?: number | null;
  baseAgree?: number;
  baseDisagree?: number;
}

// ---------------------------------------------------------------------------
// Dataset summary
// ---------------------------------------------------------------------------

/** (DatasetSummary from datasetExport.ts) */
export interface JewelsDatasetSummary {
  appId: string;
  methodId: string;
  window: { start: string | null; end: string | null };
  /** Graded pairs seen in the window (every exclusion bucket below sums back). */
  gradedPairs: number;
  files: Record<DatasetFile, { rows: number; bytes: number }>;
  excluded: {
    /** Not a decision moment (grade said so). */
    skip: number;
    /** Proposed, nobody acted — unconsumed is not wrong (PU-learning). */
    expired: number;
    /** The run failed before grading. */
    ungraded: number;
    /** Auto commits — no independent human signal. */
    auto: number;
    /**
     * Pairs a file wanted but whose jewel never attached a trace.
     * This is the trace-coverage nag.
     */
    traceless: number;
    /** Traces attached but no longer retrievable. */
    traceMissing: number;
    /**
     * Corrections whose captured completion couldn't be re-rendered with
     * the human's decision swapped in.
     */
    preferenceUnrenderable: number;
  };
  /** Agreement pairs with a usable trace / all agreement pairs. */
  traceCoverage: number | null;
  splitEvalFraction: number;
}

// ---------------------------------------------------------------------------
// Result types per command
// ---------------------------------------------------------------------------

/** jewels overview → GET /_internal/v2/apps/:appId/jewels/overview */
export interface JewelsOverviewResult {
  window: { start: string; end: string };
  methods: Array<{
    methodId: string;
    name: string;
    autonomy: string | null;
    /** Canary/cost dial — EXPECTED coverage equals sampleRate. */
    sampleRate: number;
    hasJewel: boolean;
    jewelRoles: unknown[];
    /** Pending approval-queue depth; 0 for non-approve-mode methods. */
    queuedCount: number;
    // The following are only present when hasJewel is true:
    pairs?: {
      total: number;
      agree: number;
      disagree: number;
      skip: number;
      expired: number;
      ungraded: number;
    };
    /** agree / (agree + disagree); null when no graded pairs in window. */
    agreementRate?: number | null;
    humanInvocations?: number;
    coverage?: number | null;
    lastPairAt?: string | null;
    training?: {
      active: {
        runId: string;
        status: TrainingRunStatus;
        progress: Record<string, any> | null;
        createdAt: string;
      } | null;
      lastRun: {
        runId: string;
        status: TrainingRunStatus;
        error: string | null;
        finishedAt: string | null;
      } | null;
      latestModel: {
        runId: string;
        baseModel: string;
        agreement: number | null;
        evalRows: number | null;
        trainRows: number | null;
        trainLoss: number | null;
        finishedAt: string | null;
      } | null;
    };
  }>;
  totals: {
    pairs: number;
    agree: number;
    disagree: number;
    skip: number;
    expired: number;
    ungraded: number;
    agreementRate: number | null;
    shadowedMethods: number;
    totalMethods: number;
  };
}

/** jewels pairs → GET /_internal/v2/apps/:appId/jewels/pairs */
export interface JewelsPairsResult {
  pairs: JewelPairSummaryRow[];
  nextCursor: string | null;
}

/** jewels pair <pairId> → GET /_internal/v2/apps/:appId/jewels/pairs/:pairId */
export interface JewelsPairResult {
  pair: JewelPairRow;
  /**
   * Hydrated model transcripts (propose + grade phases). Objects that could
   * not be fetched degrade to `{ id, phase, missing: true }` rather than a 500.
   * The trace content beyond id/phase/missing is dynamic model IO.
   */
  traces: Array<{
    id: string;
    phase: 'propose' | 'grade';
    missing?: true;
    [key: string]: unknown;
  }>;
}

/** jewels queue → GET /_internal/v2/apps/:appId/jewels/queue */
export interface JewelsQueueResult {
  items: Array<{
    id: string;
    methodId: string;
    /** The triggering subject — input fields the jewel was asked to decide on. */
    subject: Record<string, unknown>;
    /** The jewel's proposed output (dynamic model IO). */
    proposed: unknown | null;
    /** The jewel's reasoning prose. */
    reasoning: unknown | null;
    jewelRequestId: string | null;
    proposedAt: string;
    expiresAt: string;
  }>;
}

/** One bucket in a timeseries response. (JewelTimeseriesBucket from V2JewelPairsDao) */
export interface JewelsTimeseriesBucket {
  bucketStart: string;
  agree: number;
  disagree: number;
  skip: number;
  expired: number;
  ungraded: number;
  total: number;
}

/** jewels timeseries → GET /_internal/v2/apps/:appId/jewels/timeseries */
export interface JewelsTimeseriesResult {
  start: string;
  end: string;
  intervalSec: number;
  methods: Array<{ methodId: string; buckets: JewelsTimeseriesBucket[] }>;
}

/**
 * jewels resolve → POST /_internal/v2/apps/:appId/jewels/queue/resolve
 *
 * resolution is one of 'approved' | 'edited' | 'dismissed'.
 * output is the method's return value (approve only; dynamic model IO).
 */
export interface JewelsResolveResult {
  resolution: string;
  output?: unknown;
}

/**
 * jewels dryrun → POST /_internal/v2/apps/:appId/jewels/:methodId/dryrun
 *
 * record is the JewelPairRecord from the live jewel's eval run.
 * Dynamic model IO; includes mode, proposed, reasoning, error if any.
 */
export interface JewelsDryrunResult {
  record: unknown;
}

/**
 * jewels export (no --file) → GET /_internal/v2/apps/:appId/jewels/export
 *
 * With --file the command uses apiRaw (streaming JSONL) and needs no result type.
 */
export interface JewelsExportResult {
  summary: JewelsDatasetSummary;
}

/** jewels train → POST /_internal/v2/apps/:appId/jewels/train */
export interface JewelsTrainResult {
  run: TrainingRunRow;
  /** Dataset report: per-file row counts and every exclusion bucket. */
  summary: Record<string, any>;
}

/** jewels runs → GET /_internal/v2/apps/:appId/jewels/training-runs */
export interface JewelsRunsResult {
  runs: TrainingRunRow[];
}

/**
 * jewels run <runId> → GET /_internal/v2/apps/:appId/jewels/training-runs/:runId
 *
 * Also used for the --wait polling loop in `jewels train`.
 */
export interface JewelsRunResult {
  run: TrainingRunRow;
}

/**
 * jewels grade <runId> →
 *   POST /_internal/v2/apps/:appId/jewels/training-runs/:runId/grade
 */
export interface JewelsGradeResult {
  grading: JewelsGrading;
}
