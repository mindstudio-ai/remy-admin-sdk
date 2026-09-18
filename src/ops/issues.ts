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

// The origin the API should credit for an entry this client writes, as a
// spreadable fragment. Empty when the client is acting as the app it is pointed
// at, which is the ordinary case and the one the API reads as "my own agent".
function authorship(ctx: AdminContext): { originAppId?: string } {
  return ctx.originAppId ? { originAppId: ctx.originAppId } : {};
}

export interface IssuesListParams {
  /** Filter by status: `open` or `closed`. Omit for any state. */
  status?: string;
  /** Match issues carrying ANY of these labels. */
  labels?: string[];
  /** Only issues another app filed here, by that app's id. */
  originAppId?: string;
  /** Max issues to return (default 50). */
  limit?: number;
  /** Keyset cursor from a previous response's `nextCursor`. */
  cursor?: string;
}

// The wire names the list routes read. `labels` is sent as a repeated `label`
// param, so the mapping is explicit rather than a field rename away from
// silently dropping the filter.
function listQuery(params: IssuesListParams): string {
  return qs({
    status: params.status,
    label: params.labels,
    originAppId: params.originAppId,
    limit: params.limit,
    cursor: params.cursor,
  });
}

/**
 * List the issues filed IN an app, newest-first.
 *
 * @throws AdminApiError `invalid_status` (400) — status is not `open` or
 *   `closed`.
 * @example
 * const { issues } = await admin.issues.list({ status: 'open', labels: ['bug'] });
 */
export function list(ctx: AdminContext, params: IssuesListParams = {}) {
  return call<IssuesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/issues${listQuery(params)}`,
  );
}

/**
 * List the issues this app filed INTO other apps, newest-first.
 *
 * The sender's half of a cross-app thread: one call returns every issue the
 * app sent out, so a fan-out across forty apps is read once rather than forty
 * times. Scoped to apps in the same workspace.
 *
 * @throws AdminApiError `invalid_status` (400) — status is not `open` or
 *   `closed`.
 * @example
 * const { issues } = await admin.issues.filed({ status: 'open' });
 */
export function filed(
  ctx: AdminContext,
  params: Omit<IssuesListParams, 'originAppId'> = {},
) {
  return call<IssuesListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/issues/filed${listQuery(params)}`,
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
  /** Labels to file it under. Open set, at most 20, 64 chars each. */
  labels?: string[];
  /**
   * The app filing this, when it isn't the app the issue lands in. Defaults to
   * `ctx.originAppId` — set whenever the caller retargeted at another app — so
   * cross-app authorship is recorded without anyone opting in. Pass it
   * explicitly only to override that.
   */
  originAppId?: string;
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
 *   `invalid_labels` (400) — labels are not strings, or exceed the count /
 *   length caps; `invalid_origin_app_id` (400) — originAppId is not an app id.
 * @example
 * const { issue } = await admin.issues.create({ title: 'Checkout 500s on empty cart', labels: ['bug'] });
 */
export function create(ctx: AdminContext, params: IssuesCreateParams) {
  const requestBody: Record<string, unknown> = {
    title: params.title,
    authorKind: 'agent',
  };
  if (params.body !== undefined) {
    requestBody.body = params.body;
  }
  if (params.labels !== undefined) {
    requestBody.labels = params.labels;
  }
  const originAppId = params.originAppId ?? ctx.originAppId;
  if (originAppId !== undefined) {
    requestBody.originAppId = originAppId;
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
    { body, authorKind: 'agent', ...authorship(ctx) },
  );
}

/**
 * Close an issue, optionally with a closing comment.
 *
 * Records a `closed` timeline event on the thread, preceded by the comment
 * when one is given — so answering and resolving is one call, which is what
 * replying to an issue another app filed usually amounts to.
 *
 * @param number The issue number.
 * @param comment Optional prose posted before the close event.
 * @throws AdminApiError `issue_not_found` (404) — no issue with this number
 *   in this app.
 * @example
 * await admin.issues.close('42', 'Already fixed in v3 — no change needed.');
 */
export function close(ctx: AdminContext, number: string, comment?: string) {
  const requestBody: Record<string, unknown> = {
    status: 'closed',
    authorKind: 'agent',
    ...authorship(ctx),
  };
  if (comment !== undefined) {
    requestBody.comment = comment;
  }
  return call<IssuesUpdateResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/issues/${seg(number)}/update`,
    requestBody,
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
    { status: 'open', authorKind: 'agent', ...authorship(ctx) },
  );
}

export interface IssuesEditParams {
  /** Replace the issue's title (non-empty). */
  title?: string;
  /** Replace the issue's body. */
  body?: string;
  /** Replace the issue's labels wholesale (not a merge). */
  labels?: string[];
  /** Change the status to `open` or `closed`. */
  status?: string;
}

/**
 * Edit an issue's title, body, labels, or status.
 *
 * Status transitions record a `closed` or `reopened` timeline event
 * automatically.  At least one field must be provided.
 *
 * @param number The issue number.
 * @throws AdminApiError `missing_title` (400) — title was supplied but empty;
 *   `invalid_labels` (400) — labels are not strings, or exceed the count /
 *   length caps; `invalid_status` (400) — status is not `open` or `closed`;
 *   `no_fields` (400) — no editable field was provided; `issue_not_found`
 *   (404) — no issue with this number in this app.
 * @example
 * await admin.issues.edit('42', { status: 'closed' });
 */
export function edit(
  ctx: AdminContext,
  number: string,
  params: IssuesEditParams,
) {
  const requestBody: Record<string, unknown> = {
    authorKind: 'agent',
    ...authorship(ctx),
  };
  if (params.title !== undefined) {
    requestBody.title = params.title;
  }
  if (params.body !== undefined) {
    requestBody.body = params.body;
  }
  if (params.labels !== undefined) {
    requestBody.labels = params.labels;
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
