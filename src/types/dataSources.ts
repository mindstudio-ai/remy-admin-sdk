/**
 * Response types for the data-sources management API.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/dataSources.ts
 *   src/common/DataSources/pipeline.ts
 *   src/common/DataSources/searchDataSource.ts
 *   src/common/Db/v2Apps/V2DataSourcesDao.ts
 *
 * 204/empty responses surface as `{ ok: true; status: number }` (readBody in api.ts).
 */

/**
 * Chunking settings pinned at pipeline creation.
 * Any change requires a revectorize, not a config update.
 */
/**
 * `structural` splits on document structure (headings, blocks, paragraphs);
 * `whole` embeds each document as a single chunk, for corpora of short records
 * where the document is the retrieval unit.
 */
export type DataSourcesChunkingStrategy = 'structural' | 'whole';

export interface DataSourcesChunkingConfig {
  strategy: DataSourcesChunkingStrategy;
  version: number;
  /**
   * Rough char budget per chunk; structure wins over budget, never the reverse.
   * For `whole`, the ceiling above which a document is chunked structurally
   * instead (default 24000).
   */
  maxChars: number;
  /** Below this a chunk is merged forward rather than embedded on its own. */
  minChars: number;
  /**
   * Extraction block types discarded before chunking.
   * Corpus-dependent: page furniture is noise in most corpora.
   */
  dropBlockTypes: string[];
}

/** Ingest configuration pinned to a pipeline version. */
export interface DataSourcesIngestConfig {
  extraction: { modelId: string };
  chunking: DataSourcesChunkingConfig;
  /** Per-chunk LLM context blurb prepended before embedding. */
  contextual: { enabled: boolean; modelId: string | null };
  /**
   * Vision pass over embedded images. On by default: a text-only document costs
   * nothing, but an undescribed chart is invisible to search.
   */
  images: { describe: boolean; modelId: string | null };
  /** Tokenizer version behind the lexical vectors — index and query must agree. */
  sparse: { version: number };
  embedding: { modelId: string; dimensions: number };
}

/**
 * Sparse update payloads for POST /datasources/config. Only the keys the
 * caller wants changed are sent — the server deep-merges, so "don't touch"
 * and "turn off" stay distinct on the wire (see configFromFlags).
 */
export interface DataSourcesIngestUpdate {
  chunking?: {
    /** Naming a strategy pins its current version; versions are not settable. */
    strategy?: DataSourcesChunkingStrategy;
    maxChars?: number;
    minChars?: number;
    dropBlockTypes?: string[];
  };
  contextual?: { enabled?: boolean; modelId?: string };
  images?: { describe?: boolean; modelId?: string };
  /**
   * `dimensions` must be the model's native size or one of its Matryoshka
   * sizes; omitted = native. Either half alone re-resolves the pair.
   */
  embedding?: { modelId?: string; dimensions?: number };
  extraction?: { modelId: string };
}

export interface DataSourcesRetrievalUpdate {
  hybrid?: boolean;
  rerank?: { enabled?: boolean; modelId?: string };
  topK?: number;
}

/** Live retrieval settings — take effect on the next query, no rebuild required. */
export interface DataSourcesRetrievalConfig {
  /** Fuse dense with lexical. Free to toggle because sparse vectors are always written. */
  hybrid: boolean;
  rerank: { enabled: boolean; modelId: string | null; candidates: number };
  adaptive: { enabled: boolean; gap: number };
  topK: number;
}

/**
 * Document row as returned by the API.
 *
 * `sourceKey` is store-relative (not an S3 key) and is kept here for
 * completeness, though the CLI does not address objects by it.
 */
export interface DataSourcesDocument {
  id: string;
  dataSourceId: string;
  appId: string;
  contentHash: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  /** Store-relative key for the source document in the datasource-uploads store. */
  sourceKey: string;
  /** App-supplied scalar metadata set at add time; filterable at search time. */
  metadata: Record<string, string | number | boolean> | null;
  createdAt: string;
  updatedAt: string;
}

/** One document with its current build state, as returned by GET /datasources/documents. */
export interface DataSourcesDocumentStatus {
  id: string;
  filename: string | null;
  contentHash: string;
  /**
   * 'processing' | 'done' | 'error'.
   * A document with no build row yet is also surfaced as 'processing'.
   */
  status: string;
  errorMessage: string | null;
  chunkCount: number | null;
  pageCount: number | null;
  metadata: Record<string, string | number | boolean> | null;
  ingestedAt: string | null;
}

/**
 * GET /datasources/documents — one page of per-document ingest state for one
 * pipeline, oldest first.
 *
 * `pipelineVersion` is absent when the data source does not exist (returns `{ documents: [] }`).
 * `candidate=true` watches a migration in progress. `nextCursor` is set when
 * more pages follow; `allDocuments` walks them.
 */
export interface DataSourcesDocumentsResult {
  pipelineVersion?: number;
  nextCursor?: string | null;
  documents: DataSourcesDocumentStatus[];
}

/**
 * POST /datasources/upload-token — discriminated union on `alreadyCurrent`.
 *
 * alreadyCurrent=true: file unchanged; CLI skips upload (metadata updated in-place).
 * alreadyCurrent=false: proceed with presigned upload then confirm via POST /documents.
 */
export type DataSourcesUploadTokenResult =
  | {
      alreadyCurrent: true;
      document: DataSourcesDocument;
    }
  | {
      alreadyCurrent: false;
      contentType: string;
      upload: {
        key: string;
        uploadUrl: string;
        uploadFields: Record<string, string>;
      };
    };

/** POST /datasources/documents — confirm an uploaded document and queue a build. */
export interface DataSourcesDocumentConfirmResult {
  document: DataSourcesDocument;
  queued: boolean;
}

/** Build progress counts used in several list and status shapes. */
export interface DataSourcesBuildProgress {
  total: number;
  done: number;
  processing: number;
  error: number;
}

/**
 * Where a source's index lives. Null is the shared pool. `phase` is the
 * resource's lifecycle phase (see types/infra.ts); anything but `active` means
 * searches on this source fail with `capacity_<phase>`.
 */
export interface DataSourcesPlacement {
  resourceId: string;
  name: string | null;
  offeringLabel: string | null;
  phase: string;
}

/**
 * A placement move in flight on the active version, or the last one's
 * failure; null when idle. The points are copied from durable storage onto
 * the target in the background (no re-embedding); the source flips when
 * `copied` reaches `total`. While it runs, writes to the source are refused
 * with `data_source_migrating`; search keeps serving from the old placement.
 * A sibling of `placement` because a source on the shared pool (placement
 * null) can be moving too.
 */
export interface DataSourcesMigration {
  /** Where it is going; null is the shared pool. */
  toResourceId: string | null;
  toName: string | null;
  copied: number;
  total: number;
  startedAt: string;
  /** Set when the move failed; the source is unfrozen and a new move may start. */
  error: string | null;
}

/** One data source in the GET /datasources listing. */
export interface DataSourcesListEntry {
  id: string;
  slug: string;
  name: string | null;
  /** Total document count (active pipeline). */
  documentCount: number;
  counts: DataSourcesBuildProgress;
  /** Source-document bytes (does not include vector storage). */
  storageBytes: number;
  chunkCount: number;
  /** When the most recent document finished building on the active version. */
  lastIngestedAt: string | null;
  activeVersion: number | null;
  embeddingModelId: string | null;
  dimensions: number | null;
  /** Present while a revectorization is in flight. */
  candidate: { version: number; progress: DataSourcesBuildProgress } | null;
  /** Dedicated placement, or null for the shared pool. */
  placement: DataSourcesPlacement | null;
  /** A move in flight, or its last failure. */
  migration: DataSourcesMigration | null;
  createdAt: string;
}

/** GET /datasources — all data sources for the app. */
export interface DataSourcesListResult {
  dataSources: DataSourcesListEntry[];
}

/** Citation pointing a search result back at its source document. */
export interface DataSourcesSearchCitation {
  documentId: string;
  filename: string | null;
  pageNumber: number | null;
  /** Position within the document — joins a hit back to GET /chunks. */
  chunkIndex: number | null;
  headingPath: string[];
  boundingBox?: {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
  };
  /** On-domain URL for the source document. */
  url: string;
}

/** One search result from POST /datasources/search. */
export interface DataSourcesSearchResultItem {
  score: number;
  text: string;
  citation: DataSourcesSearchCitation;
  /** Rank and score from retrieval, before reranking. */
  retrievalRank?: number;
  retrievalScore?: number;
  /** Branch attribution — only when `explain` was asked for. */
  explain?: unknown;
  /** base64 Float32Array — only when `includeVectors` was asked for. */
  vector?: string;
  /** Surrounding chunks — only when `expand` was asked for. */
  neighbors?: { before: string[]; after: string[] };
  /** Query-term offsets into `text` — only when `highlight` was asked for. */
  matches?: { start: number; end: number; token: string }[];
}

/**
 * POST /datasources/search.
 *
 * `mode` reports what actually ran (e.g. `reranked: false` after an adaptive skip
 * or a reranker outage) rather than what was requested.
 */
export interface DataSourcesSearchResult {
  results: DataSourcesSearchResultItem[];
  mode: {
    search: 'hybrid' | 'semantic' | 'lexical';
    hybrid: boolean;
    reranked: boolean;
    pipelineVersion: number;
  };
  /** base64 Float32Array — only when `includeQueryVector` was asked for. */
  queryVector?: string;
  elapsedMs: number;
}

/**
 * GET /datasources/config — full pipeline configuration for one data source.
 *
 * Split by change cost: `ingest` is pinned and requires a revectorize to change;
 * `retrieval` is live and takes effect on the next query.
 */
export interface DataSourcesConfigResult {
  slug: string;
  ingest: {
    version: number;
    fingerprint: string;
    config: DataSourcesIngestConfig;
  } | null;
  retrieval: Partial<DataSourcesRetrievalConfig>;
  candidate: { version: number; config: DataSourcesIngestConfig } | null;
}

/**
 * POST /datasources/config — response after updating configuration.
 *
 * `placementChanged` with `migration` set means a populated source started a
 * background move rather than moving on the spot.
 */
export interface DataSourcesConfigUpdateResult {
  ingestChanged: boolean;
  placementChanged: boolean;
  ingest: DataSourcesIngestConfig;
  retrieval: Partial<DataSourcesRetrievalConfig>;
  placement: DataSourcesPlacement | null;
  migration: DataSourcesMigration | null;
}

/** POST /datasources — an empty source, on the requested placement. */
export interface DataSourcesCreateResult {
  dataSource: {
    id: string;
    slug: string;
    name: string | null;
    /** Dedicated resource id, or null for the shared pool. */
    resourceId: string | null;
    createdAt: string;
  };
  pipeline: { version: number; config: DataSourcesIngestConfig };
  placement: DataSourcesPlacement | null;
  migration: DataSourcesMigration | null;
}

/** POST /datasources/move — the move as started (or applied, for an empty source). */
export interface DataSourcesMoveResult {
  placement: DataSourcesPlacement | null;
  /** Null when the source was empty and moved on the spot. */
  migration: DataSourcesMigration | null;
}

/**
 * POST /datasources/revectorize — starts a new candidate pipeline alongside the live one.
 *
 * `changes` is a human-readable list of config diffs between old and new versions.
 */
export interface DataSourcesRevectorizeResult {
  candidateVersion: number;
  activeVersion: number;
  /** Number of documents queued for re-embedding. */
  queued: number;
  /** Human-readable list of config changes from the active version. */
  changes: string[];
}

/** POST /datasources/promote — make the candidate version live. */
export interface DataSourcesPromoteResult {
  activeVersion: number;
  /** Version that was retired (replaced); null if no previous active existed. */
  retiredVersion: number | null;
}

/** POST /datasources/versions/drop — discard a candidate or retired version. */
export interface DataSourcesDropResult {
  dropped: number;
}

/** POST /datasources/delete — delete every version, document, and byte. */
export interface DataSourcesDeleteResult {
  deleted: true;
  /** Number of documents removed. */
  documents: number;
  /** Number of pipeline versions dropped. */
  versions: number;
}

/**
 * POST /datasources/documents/delete — always responds 204 (empty body).
 *
 * Surfaces as `{ ok: true; status: number }` via readBody in api.ts.
 */
export interface DataSourcesDocumentDeleteResult {
  ok: true;
  status: number;
}
