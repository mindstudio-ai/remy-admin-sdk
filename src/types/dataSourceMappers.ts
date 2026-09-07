/**
 * Response types for data-source mappers: inspecting raw objects, testing a
 * mapper, remapping, and a job's quarantine.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/dataSourceMappers.ts
 *   src/common/DataSources/mapping.ts (mapperView, buildInspectReport)
 */

import type { DataSourceJob } from './dataSourceJobs.js';

/**
 * The mapper a source runs: the file it was compiled from, its version, and
 * the build it came from. The build fields are null for a tunnel run of local
 * source (`map test --dev`).
 */
export interface DataSourceMapper {
  path: string;
  /** The compiled bundle key, or `dev:<sessionId>` for a tunnel run; stamped on the documents it produces. */
  mapperKey: string;
  timeoutMs: number;
  releaseId: string | null;
  branch: string | null;
  commitSha: string | null;
  /** When this bundle became the source's active mapper. */
  activatedAt: string | null;
}

/** POST /datasources/mapper/deploy */
export interface DataSourceMapDeployResult {
  dataSource: { id: string; slug: string };
  mapper: DataSourceMapper;
  /** False when the source already ran this bundle. */
  changed: boolean;
}

/** Which objects an inspect or map test looked at. */
export type DataSourceObjectSelection =
  | {
      kind: 'store';
      store: string;
      access: 'private' | 'public';
      prefix: string;
    }
  | { kind: 'connector' };

export interface DataSourceInspectReport {
  objects: number;
  bytes: number;
  /** True when the listing stopped at the limit. */
  truncated: boolean;
  byExtension: { extension: string; count: number; bytes: number }[];
  /** Keys grouped by shape, digit runs and ids collapsed: `2024/#/{uuid}.json`. */
  clusters: {
    pattern: string;
    extension: string;
    count: number;
    bytes: number;
    examples: string[];
  }[];
  sizeBuckets: { label: string; count: number }[];
  /** Up to ten objects read (first 256 KB each). */
  samples: {
    key: string;
    size: number | null;
    contentType: string | null;
    encoding: 'utf-8' | 'binary';
    empty: boolean;
    /** Top-level keys when the head parsed as a JSON object. */
    jsonKeys: string[] | null;
    /** Line count for text that was not one JSON object (JSONL, CSV, ...). */
    lines: number | null;
    textLength: number;
    head: string;
  }[];
  /** Distinct top-level JSON key sets across the samples, most common first. */
  jsonSignatures: { keys: string[]; count: number }[];
}

/** POST /datasources/inspect */
export interface DataSourceInspectResult {
  selection: DataSourceObjectSelection;
  report: DataSourceInspectReport;
}

/** One mapped document as a map test previews it (markdown truncated). */
export interface DataSourceMapTestDocument {
  externalId: string;
  title: string;
  metadata: Record<string, string | number | boolean> | null;
  replaces: string[];
  markdownBytes: number;
  preview: string;
}

export type DataSourceMapTestOutcome =
  | { kind: 'documents'; documents: DataSourceMapTestDocument[] }
  | {
      kind: 'passthrough';
      metadata: Record<string, string | number | boolean> | null;
    }
  | { kind: 'skip'; reason: string }
  | { kind: 'deletes'; externalIds: string[] }
  | { kind: 'error'; message: string; stack?: string };

/** POST /datasources/map-test */
export interface DataSourceMapTestResult {
  mapper: DataSourceMapper;
  /** The mapper ran from local source through the dev session. */
  dev: boolean;
  objects: number;
  /** Documents produced across every `documents` outcome. */
  produced: number;
  counts: {
    documents: number;
    passthrough: number;
    skip: number;
    deletes: number;
    error: number;
  };
  results: {
    key: string;
    outcome: DataSourceMapTestOutcome;
    durationMs: number;
  }[];
}

/** POST /datasources/remap, POST /datasources/jobs/:id/replay */
export interface DataSourceRemapResult {
  job: DataSourceJob;
  mapper: DataSourceMapper;
  dataSource: { id: string; slug: string };
}

/** One object a job's mapper did not turn into documents. */
export interface DataSourceQuarantinedObject {
  id: string;
  /** The key or URL the object was known by. */
  ref: string;
  kind: 'skip' | 'error';
  reason: string;
  /** False when the object's raw copy never landed — a replay cannot reach it. */
  replayable: boolean;
  at: string;
}

/** GET /datasources/jobs/:id/quarantine */
export interface DataSourceQuarantineResult {
  job: { id: string; state: string };
  dataSource: { id: string; slug: string };
  counts: { skipped: number; errors: number };
  /** Reasons by frequency, most common first. */
  reasons: { kind: 'skip' | 'error'; reason: string; count: number }[];
  objects: DataSourceQuarantinedObject[];
  nextCursor: string | null;
}
