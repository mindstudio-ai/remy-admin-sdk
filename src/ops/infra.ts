/**
 * Provisioned-infrastructure operations: lease, park, resume and delete
 * dedicated resources (first kind: retrieval capacity for data sources).
 *
 * Ops are pure (ctx, params) → typed result. The CLI skin in
 * commands/infra.ts owns flag parsing, progress printing and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call } from '../http.js';
import { renderProgress } from '../output.js';
import { elapsedSeconds, pollUntil, timedOut } from '../poll.js';
import type {
  InfraGetResult,
  InfraListResult,
  InfraLogsResult,
  InfraPhase,
  InfraResource,
  InfraResourceResult,
} from '../types/infra.js';

/** @internal Consumed by the CLI skin; waitForPhase documents the default. */
export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 3000;

function base(appId: string): string {
  return `/_internal/v2/apps/${appId}/infra`;
}

// ─── list ────────────────────────────────────────────────────────────────────

export interface ListParams {
  /** Include resources that have been deleted; off by default. */
  includeDestroyed?: boolean;
}

/**
 * The app's dedicated resources plus the offerings it can provision, with
 * their hourly and monthly prices.
 *
 * @example
 * const { resources, offerings } = await admin.infra.list();
 */
export function list(ctx: AdminContext, params?: ListParams) {
  return call<InfraListResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}${params?.includeDestroyed ? '?includeDestroyed=true' : ''}`,
  );
}

// ─── get ─────────────────────────────────────────────────────────────────────

export interface GetParams {
  /** Resource id. */
  id: string;
}

/**
 * One resource with its state timeline and the data sources placed on it.
 *
 * @throws AdminApiError `resource_not_found` (404).
 */
export function get(ctx: AdminContext, params: GetParams) {
  return call<InfraGetResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}`,
  );
}

// ─── logs ────────────────────────────────────────────────────────────────────

export interface LogsParams {
  /** Resource id. */
  id: string;
  /** Continue after this line id (the last line of a previous page). */
  after?: string;
  /** Lines per page; without `after`, the newest this many. Max 500. */
  limit?: number;
}

/**
 * The platform's narration of a resource, oldest first: the steps a
 * transition went through, failed attempts, and failures with the pod's
 * events and a warnings-and-errors tail of the instance log. Not the
 * instance's own stdout.
 *
 * @throws AdminApiError `resource_not_found` (404).
 */
export function logs(ctx: AdminContext, params: LogsParams) {
  const query = new URLSearchParams();
  if (params.after) {
    query.set('after', params.after);
  }
  if (params.limit) {
    query.set('limit', String(params.limit));
  }
  const search = query.toString();
  return call<InfraLogsResult>(
    ctx,
    'GET',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/logs${search ? `?${search}` : ''}`,
  );
}

// ─── provision ───────────────────────────────────────────────────────────────

export interface ProvisionParams {
  /** Offering id from `list().offerings`, e.g. `retrieval.small`. */
  offeringId: string;
  /** Display name; defaults to the offering label. */
  name?: string;
}

/**
 * Lease a new resource. Spends credits: the workspace must have a month's
 * worth available before the request is accepted; nothing is charged until
 * activation, and from then the resource bills by the hour.
 *
 * The response is the row in `requested`; the platform brings it to `active`
 * within a minute or so. Use `waitForPhase` to block on that.
 *
 * @throws AdminApiError `offering_not_found` (400), `offering_retired` (422),
 *   `provisioning_unavailable` (422), `insufficient_credits` (402).
 * @example
 * const { resource } = await admin.infra.provision({ offeringId: 'retrieval.small' });
 */
export function provision(ctx: AdminContext, params: ProvisionParams) {
  return call<InfraResourceResult>(ctx, 'POST', base(ctx.appId), {
    offeringId: params.offeringId,
    ...(params.name ? { name: params.name } : {}),
  });
}

// ─── hibernate / resume / destroy / rename ───────────────────────────────────

export interface ResourceIdParams {
  /** Resource id. */
  id: string;
}

/**
 * Park an active resource. Data is kept; searches on its data sources return
 * `capacity_hibernating` while it parks and `capacity_hibernated` once parked,
 * until it resumes; billing drops to the retained-storage rate.
 *
 * @throws AdminApiError `resource_not_found` (404), `invalid_transition` (422).
 */
export function hibernate(ctx: AdminContext, params: ResourceIdParams) {
  return call<InfraResourceResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/hibernate`,
  );
}

/**
 * Bring a hibernated (or failed) resource back to active.
 *
 * @throws AdminApiError `resource_not_found` (404), `invalid_transition` (422).
 */
export function resume(ctx: AdminContext, params: ResourceIdParams) {
  return call<InfraResourceResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/resume`,
  );
}

/**
 * Delete a resource. Refused while any data source is placed on it — move
 * those to shared capacity (`admin.dataSources.move({ placement: 'shared' })`,
 * data intact) or delete them first. Billing stops when the phase reaches
 * `destroyed`.
 *
 * @throws AdminApiError `resource_not_found` (404),
 *   `resource_has_attachments` (422), `invalid_transition` (422).
 */
export function destroy(ctx: AdminContext, params: ResourceIdParams) {
  return call<InfraResourceResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/destroy`,
  );
}

export interface ResizeParams {
  id: string;
  /** Offering id from `list().offerings`, e.g. `retrieval.medium`. */
  offeringId: string;
}

/**
 * Change a resource's size, keeping its documents.
 *
 * The platform parks the resource, swaps its spec, and brings it back up with
 * its sources' indexes rebuilt from durable storage in the background, so a
 * resize passes through `hibernated` and searches on those sources answer
 * `index_warming` with the rebuild's progress until it lands. A resource that
 * is already hibernated swaps in place and stays parked. Growing is gated on a
 * month of credits at the new rate like a provision; shrinking is refused
 * below what the resource holds. The response carries `resizingTo` until the
 * swap has happened; `waitForPhase` with `until: (r) => r.resizingTo === null`
 * blocks on the whole thing.
 *
 * @throws AdminApiError `resource_not_found` (404), `offering_not_found`
 *   (400), `offering_retired` (422), `same_offering` (400),
 *   `offering_kind_mismatch` (400), `resize_pending` (422), `resize_too_small`
 *   (422), `insufficient_credits` (402), `invalid_transition` (422).
 * @example
 * await admin.infra.resize({ id, offeringId: 'retrieval.medium' });
 */
export function resize(ctx: AdminContext, params: ResizeParams) {
  return call<InfraResourceResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/resize`,
    { offeringId: params.offeringId },
  );
}

export interface RenameParams {
  id: string;
  name: string;
}

/** @throws AdminApiError `resource_not_found` (404), `invalid_name` (400). */
export function rename(ctx: AdminContext, params: RenameParams) {
  return call<InfraResourceResult>(
    ctx,
    'POST',
    `${base(ctx.appId)}/${encodeURIComponent(params.id)}/rename`,
    { name: params.name },
  );
}

// ─── waitForPhase ────────────────────────────────────────────────────────────

export interface WaitForPhaseParams {
  id: string;
  /** The phase(s) that count as done. */
  phases: InfraPhase[];
  /**
   * An extra condition on top of the phase — a resize, for one, ends in the
   * phase it started from and is done only once `resizingTo` has cleared.
   */
  until?: (resource: InfraResource) => boolean;
  /** How long without movement before giving up. Default 10 minutes. */
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

export type WaitForPhaseResult =
  | { status: 'done'; resource: InfraResource }
  | { status: 'failed'; resource: InfraResource; error: string }
  | { status: 'timeout'; resource: InfraResource; error: string };

/**
 * Poll a resource until it reaches one of `phases`, fails, or the timeout
 * elapses. A `failed` phase returns immediately with the platform's error.
 *
 * @example
 * const result = await admin.infra.waitForPhase({ id, phases: ['active'] });
 */
export async function waitForPhase(
  ctx: AdminContext,
  params: WaitForPhaseParams,
): Promise<WaitForPhaseResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const wanted = new Set<InfraPhase>(params.phases);
  const arrived = (resource: InfraResource) =>
    wanted.has(resource.phase) && (params.until?.(resource) ?? true);

  const outcome = await pollUntil(
    async () => (await get(ctx, { id: params.id })).resource,
    (resource) => arrived(resource) || resource.phase === 'failed',
    {
      timeoutMs,
      pollMs: POLL_MS,
      describe: (resource, start) =>
        resource.progress
          ? renderProgress(
              resource.progress,
              start,
              resource.resizingTo
                ? `resizing to ${resource.resizingTo.label}`
                : null,
            )
          : `${resource.phase}${resource.detail ? ` · ${resource.detail}` : ''}${
              resource.resizingTo
                ? ` · resizing to ${resource.resizingTo.label}`
                : ''
            }… (${elapsedSeconds(start)}s)`,
      // A rebuild after a resume runs as long as it must; the timeout bounds
      // silence, and a phase or step change counts as movement.
      progressKey: (resource) =>
        `${resource.phase}:${resource.progress?.done ?? ''}:${resource.detail ?? ''}`,
      onProgress: params.onProgress,
    },
  );
  const resource = outcome.value;
  if (!outcome.settled) {
    return {
      status: 'timeout',
      resource,
      error: timedOut(timeoutMs, `; resource is still ${resource.phase}`),
    };
  }
  if (arrived(resource)) {
    return { status: 'done', resource };
  }
  return {
    status: 'failed',
    resource,
    error: resource.lastError ?? 'The platform could not complete the change.',
  };
}
