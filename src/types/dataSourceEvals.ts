/**
 * Response types for warming, sampling and retrieval evals.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/dataSourceEvals.ts (setView, runView)
 *   src/common/DataSources/evals/types.ts
 */

import type { DataSourceJob } from './dataSourceJobs.js';
import type { OperationProgress } from './progress.js';

/**
 * An index reload in flight, or its last failure: after an eviction on the
 * shared pool, after a lost node or a resume on dedicated capacity, or a
 * reindex. Null on the source when the index is simply resident.
 */
export interface DataSourcesHydration {
  copied: number;
  total: number;
  startedAt: string;
  error: string | null;
  /** The reload in the one progress shape, with the platform's measured rate and ETA. */
  progress: OperationProgress;
}

/** POST /datasources/hydrate */
export interface DataSourcesHydrateResult {
  /** True when the points were already there and nothing was started. */
  resident: boolean;
  hydration: DataSourcesHydration | null;
}

/** POST /datasources/sample */
export interface DataSourcesSampleResult {
  dataSource: {
    id: string;
    slug: string;
    sampleOf: string;
    pipelineVersion: number;
  };
  job: DataSourceJob;
}

/** `queued` until a worker claims the generation; hand-written sets start `ready`. */
export type EvalSetState = 'queued' | 'generating' | 'ready' | 'failed';
export type EvalQueryStyle = 'cloze' | 'question';

export interface EvalSet {
  id: string;
  dataSourceId: string;
  name: string;
  description: string | null;
  state: EvalSetState;
  generation: {
    style: EvalQueryStyle;
    size: number;
    modelId: string | null;
    seed: number;
    tags: string[];
  } | null;
  queryCount: number;
  /** Model spend generating questions (estimate); zero for cloze. */
  estimatedCredits: number;
  estimatedDollars: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What should come back for a query; the content hash is what crosses sources. */
export interface EvalExpectation {
  contentHash: string;
  documentId: string;
  chunkIndex: number | null;
  filename: string | null;
}

export interface EvalQuery {
  id: string;
  setId: string;
  query: string;
  expected: EvalExpectation[];
  passage: string | null;
  tags: string[];
  origin: 'generated' | 'user';
  createdAt: string;
}

/** Partial retrieval config plus mode, merged over the target's own. */
export interface EvalRetrieval {
  mode?: 'hybrid' | 'semantic' | 'lexical';
  hybrid?: boolean;
  rerank?: { enabled?: boolean; modelId?: string | null; candidates?: number };
  adaptive?: { enabled?: boolean; gap?: number };
  topK?: number;
}

export type EvalRunState = 'queued' | 'running' | 'done' | 'failed';

export interface EvalAggregates {
  queries: number;
  scored: number;
  unresolvable: number;
  errors: number;
  recall: { at1: number; at5: number; at10: number };
  chunkRecall: { at5: number; at10: number; queries: number } | null;
  mrr: number;
  ndcg10: number;
  latency: { p50: number; p95: number; mean: number };
  estimatedCredits: number;
  estimatedCreditsPerQuery: number;
  rerankedShare: number;
  /** Which branch found the expected document, over hits in the top 10. */
  branches: {
    denseOnly: number;
    lexicalOnly: number;
    both: number;
    unexplained: number;
  };
  byTag: Record<string, { queries: number; recallAt5: number; mrr: number }>;
  truncatedTo: number | null;
  computedAt: string;
}

export interface EvalRun {
  id: string;
  setId: string;
  dataSourceId: string;
  pipelineVersion: number;
  label: string | null;
  retrieval: EvalRetrieval;
  state: EvalRunState;
  completed: number;
  total: number;
  aggregates: EvalAggregates | null;
  estimatedCredits: number;
  estimatedDollars: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One row of a run's dataset. */
export interface EvalQueryResult {
  queryId: string;
  query: string;
  tags: string[];
  resolvable: boolean;
  documentRank: number | null;
  chunkRank: number | null;
  matchedVia: 'dense' | 'lexical' | 'both' | null;
  retrieved: {
    documentId: string;
    contentHash: string | null;
    chunkIndex: number | null;
    score: number;
    retrievalRank: number | null;
    matchedVia: 'dense' | 'lexical' | 'both' | null;
  }[];
  reranked: boolean;
  latencyMs: number;
  estimatedCredits: number;
  error: string | null;
}

export interface EvalSetResult {
  set: EvalSet;
}
export interface EvalSetsListResult {
  sets: EvalSet[];
}
export interface EvalSetGetResult {
  set: EvalSet;
  dataSource: { id: string; slug: string } | null;
  queries?: EvalQuery[];
}
export interface EvalQueriesAddResult {
  added: number;
  queryCount: number;
}
export interface EvalQueriesListResult {
  queries: EvalQuery[];
}
export interface EvalRunResult {
  run: EvalRun;
  queries?: EvalQueryResult[];
}
export interface EvalRunsListResult {
  runs: EvalRun[];
}
export interface EvalCompareResult {
  a: EvalRun;
  b: EvalRun;
  /** Aggregate deltas, b minus a, for every numeric field. */
  delta: Record<string, unknown>;
  /** Per-query movement when both runs share a set; null otherwise. */
  queries: {
    wins: {
      queryId: string;
      query: string;
      rankA: number | null;
      rankB: number | null;
    }[];
    losses: {
      queryId: string;
      query: string;
      rankA: number | null;
      rankB: number | null;
    }[];
    unchanged: number;
  } | null;
}
