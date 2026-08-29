/**
 * App issues operations: CRUD for bugs, ideas, and tasks.
 *
 * Ops take resolved strings for body content — the stdin read
 * (`fs.readFileSync(0, ...)`) stays in the CLI skin (commands/issues.ts).
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  IssuesListResult,
  IssuesGetResult,
  IssuesCreateResult,
  IssuesCommentResult,
  IssuesUpdateResult,
  IssuesDeleteResult,
} from '../types/issues.js';

export interface IssuesListParams {
  /** Filter by status: `open` or `closed`. */
  status?: string;
  /** Filter by kind: `bug`, `idea`, or `task`. */
  kind?: string;
  /** Max issues to return (default 50). */
  limit?: number;
  /** Keyset cursor from a previous response's `nextCursor`. */
  cursor?: string;
}

/**
 * List issues newest-first.
 *
 * @throws AdminApiError `invalid_status` (400) — status is not `open` or
 *   `closed`; `invalid_kind` (400) — kind is not `bug`, `idea`, or `task`.
 * @example
 * const { issues } = await admin.issues.list({ status: 'open', kind: 'bug' });
 */
export function list(ctx: AdminContext, params: IssuesListParams = {}) {
  return call<IssuesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/issues${qs(params as Record<string, string | number | boolean | undefined | null>)}`,
  );
}

/**
 * Get one issue with its full comment thread.
 *
 * @param number The friendly per-app issue number (e.g. `"42"`), as shown
 *   in `list` results under `issue.number`.
 * @throws AdminApiError `issue_not_found` (404) — no issue with this number
 *   in this app.
 * @example
 * const { issue, comments } = await admin.issues.get('42');
 */
export function get(ctx: AdminContext, number: string) {
  return call<IssuesGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}`,
  );
}

export interface IssuesCreateParams {
  /** Issue title (required, non-empty). */
  title: string;
  /** Issue body in markdown. */
  body?: string;
  /** Issue kind: `bug`, `idea`, or `task` (default `bug`). */
  kind?: string;
}

/**
 * File a new issue authored as the agent (`authorKind: "agent"`).
 *
 * Returns the created issue row.  When the server is supplied a `source`
 * blob and an open issue for the same source already existed, it returns
 * that issue with `deduped: true` (no new row created); the ops layer does
 * not accept `source`, so `deduped` is always absent from op-layer responses.
 *
 * @throws AdminApiError `missing_title` (400) — title is required or empty;
 *   `invalid_kind` (400) — kind is not `bug`, `idea`, or `task`.
 * @example
 * const { issue } = await admin.issues.create({ title: 'Checkout 500s on empty cart', kind: 'bug' });
 */
export function create(ctx: AdminContext, params: IssuesCreateParams) {
  const requestBody: Record<string, unknown> = {
    title: params.title,
    authorKind: 'agent',
  };
  if (params.body !== undefined) {
    requestBody.body = params.body;
  }
  if (params.kind !== undefined) {
    requestBody.kind = params.kind;
  }
  return call<IssuesCreateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues`,
    requestBody,
  );
}

/**
 * Post a comment on an issue's thread authored as the agent.
 *
 * @param number The issue number.
 * @param body The comment body (non-empty).
 * @throws AdminApiError `missing_body` (400) — body is empty;
 *   `issue_not_found` (404) — no issue with this number in this app.
 * @example
 * await admin.issues.comment('42', 'Fixed in the latest release.');
 */
export function comment(ctx: AdminContext, number: string, body: string) {
  return call<IssuesCommentResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/comments`,
    { body, authorKind: 'agent' },
  );
}

/**
 * Close an issue.
 *
 * Records a `closed` timeline event on the thread.
 *
 * @param number The issue number.
 * @throws AdminApiError `issue_not_found` (404) — no issue with this number
 *   in this app.
 * @example
 * await admin.issues.close('42');
 */
export function close(ctx: AdminContext, number: string) {
  return call<IssuesUpdateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/update`,
    { status: 'closed', authorKind: 'agent' },
  );
}

/**
 * Reopen a closed issue.
 *
 * Records a `reopened` timeline event on the thread.
 *
 * @param number The issue number.
 * @throws AdminApiError `issue_not_found` (404) — no issue with this number
 *   in this app.
 * @example
 * await admin.issues.reopen('42');
 */
export function reopen(ctx: AdminContext, number: string) {
  return call<IssuesUpdateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/update`,
    { status: 'open', authorKind: 'agent' },
  );
}

export interface IssuesEditParams {
  /** Replace the issue's title (non-empty). */
  title?: string;
  /** Replace the issue's body. */
  body?: string;
  /** Change the kind to `bug`, `idea`, or `task`. */
  kind?: string;
  /** Change the status to `open` or `closed`. */
  status?: string;
}

/**
 * Edit an issue's title, body, kind, or status.
 *
 * Status transitions record a `closed` or `reopened` timeline event
 * automatically.  At least one field must be provided.
 *
 * @param number The issue number.
 * @throws AdminApiError `missing_title` (400) — title was supplied but empty;
 *   `invalid_kind` (400) — kind is not `bug`, `idea`, or `task`;
 *   `invalid_status` (400) — status is not `open` or `closed`; `no_fields`
 *   (400) — no editable field was provided; `issue_not_found` (404) — no
 *   issue with this number in this app.
 * @example
 * await admin.issues.edit('42', { status: 'closed' });
 */
export function edit(
  ctx: AdminContext,
  number: string,
  params: IssuesEditParams,
) {
  const requestBody: Record<string, unknown> = { authorKind: 'agent' };
  if (params.title !== undefined) {
    requestBody.title = params.title;
  }
  if (params.body !== undefined) {
    requestBody.body = params.body;
  }
  if (params.kind !== undefined) {
    requestBody.kind = params.kind;
  }
  if (params.status !== undefined) {
    requestBody.status = params.status;
  }
  return call<IssuesUpdateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/update`,
    requestBody,
  );
}

/**
 * Delete an issue.  The number is permanently retired (never reissued).
 *
 * @param number The issue number.
 * @throws AdminApiError `issue_not_found` (404) — no issue with this number
 *   in this app.
 * @example
 * await admin.issues.del('42');
 */
export function del(ctx: AdminContext, number: string) {
  return call<IssuesDeleteResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/delete`,
  );
}
