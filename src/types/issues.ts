/**
 * Result types for the `issues` CLI commands.
 *
 * Transcribed from:
 *   youai-api/src/http/routes/V2Apps/manage/issues.ts
 *   youai-api/src/common/Db/v2Apps/V2AppIssuesDao.ts
 *   youai-api/src/common/Db/v2Apps/V2AppIssueCommentsDao.ts
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type IssueKind = 'bug' | 'idea' | 'task';
export type IssueStatus = 'open' | 'closed';

/**
 * 'user' = workspace member; 'agent' = Remy agent;
 * 'system' = server-set activity events; 'sdk' = end-user report.
 */
export type IssueAuthorKind = 'user' | 'agent' | 'system' | 'sdk';

export type IssueEventType =
  'closed' | 'reopened' | 'triage_started' | 'triage_failed';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** One issue row (V2AppIssue from V2AppIssuesDao). */
export interface IssueRow {
  id: string;
  appId: string;
  /** Friendly per-app sequential number, e.g. 42. */
  number: number;
  title: string;
  body: string;
  kind: IssueKind;
  status: IssueStatus;
  authorKind: IssueAuthorKind;
  authorUserId: string | null;
  /** Free-form reporter label for 'sdk'-authored (end-user) reports; null otherwise. */
  reporter: string | null;
  releaseId: string | null;
  commitSha: string | null;
  /** Full source blob for error/crash-linked issues (e.g. { kind, key, releaseId }). */
  linkedSignal: unknown | null;
  /** Namespaced grouping key (`<kind>:<key>`) used for open-issue dedup. */
  sourceKey: string | null;
  /** Triage enrichment payload; null until enrichmentStatus is 'ready'. */
  enrichment: unknown | null;
  enrichmentStatus: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/**
 * One thread entry — either a prose comment or a structured activity event
 * (e.g. closed, reopened). (V2AppIssueComment from V2AppIssueCommentsDao)
 */
export interface IssueCommentRow {
  id: string;
  issueId: string;
  appId: string;
  entryType: 'comment' | 'event';
  eventType: IssueEventType | null;
  eventMeta: unknown | null;
  body: string;
  authorKind: IssueAuthorKind;
  authorUserId: string | null;
  /** Agent receipt blob (cost / tool trail / timing); null for human/SDK rows. */
  metadata: unknown | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Result types per command
// ---------------------------------------------------------------------------

/** issues list → GET /_internal/v2/apps/:appId/issues */
export interface IssuesListResult {
  issues: IssueRow[];
  /** Opaque keyset cursor; pass as ?cursor= to fetch the next page. */
  nextCursor: string | null;
}

/** issues get → GET /_internal/v2/apps/:appId/issues/:number */
export interface IssuesGetResult {
  issue: IssueRow;
  comments: IssueCommentRow[];
}

/**
 * issues create → POST /_internal/v2/apps/:appId/issues
 *
 * `deduped` is present only when a `source` was supplied on the request:
 * true if an open issue for the same source already existed (no new row
 * created), false if this is a fresh issue.
 */
export interface IssuesCreateResult {
  issue: IssueRow;
  deduped?: boolean;
}

/** issues comment → POST /_internal/v2/apps/:appId/issues/:number/comments */
export interface IssuesCommentResult {
  comment: IssueCommentRow;
}

/**
 * issues close / reopen / edit →
 *   POST /_internal/v2/apps/:appId/issues/:number/update
 */
export interface IssuesUpdateResult {
  issue: IssueRow;
}

/** issues delete → POST /_internal/v2/apps/:appId/issues/:number/delete */
export interface IssuesDeleteResult {
  ok: true;
}
