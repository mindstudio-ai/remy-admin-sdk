/**
 * Provisioned-infrastructure operations: lease, park, resume and delete
 * dedicated resources (first kind: retrieval capacity for data sources).
 *
 * Ops are pure (ctx, params) → typed result. The CLI skin in
 * commands/infra.ts owns flag parsing, progress printing and exit codes.
 */

import type { AdminContext } from '../ctx.js';
import { call } from '../http.js';
import { sleep } from '../sleep.js';
import type {
  InfraGetResult,
  InfraListResult,
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

// ─── provision ───────────────────────────────────────────────────────────────

export interface ProvisionParams {
  /** Offering id from `list().offerings`, e.g. `retrieval.small`. */
  offeringId: string;
  /** Display name; defaults to the offering label. */
  name?: string;
}

/**
 * Lease a new resource. Spends credits: the workspace must cover one month's
 * equivalent up front, and the resource bills hourly from activation.
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
 * `capacity_hibernated` until it resumes; billing drops to the retained-storage
 * rate.
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
 * those to shared capacity (`datasources config --placement shared`) or
 * delete them first. Billing stops when the phase reaches `destroyed`.
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
  /** Default 10 minutes. */
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
  const start = Date.now();

  for (;;) {
    const { resource } = await get(ctx, { id: params.id });
    if (wanted.has(resource.phase)) {
      return { status: 'done', resource };
    }
    if (resource.phase === 'failed') {
      return {
        status: 'failed',
        resource,
        error:
          resource.lastError ?? 'The platform could not complete the change.',
      };
    }
    if (Date.now() - start > timeoutMs) {
      return {
        status: 'timeout',
        resource,
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s; resource is still ${resource.phase}`,
      };
    }
    params.onProgress?.(
      `${resource.phase}… (${Math.round((Date.now() - start) / 1000)}s)`,
    );
    await sleep(POLL_MS);
  }
}
