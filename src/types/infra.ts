/**
 * Response types for the provisioned-infrastructure management API.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/provisionedResources.ts
 *   src/common/Provisioning/types.ts
 *   src/common/Provisioning/offerings/define.ts
 */

/** Where a resource is in its lifecycle. Written only by the platform. */
export type InfraPhase =
  | 'requested'
  | 'provisioning'
  | 'active'
  | 'hibernating'
  | 'hibernated'
  | 'resuming'
  | 'decommissioning'
  | 'destroyed'
  | 'failed';

/** What the owner asked for. Written only by the owner's actions. */
export type InfraDesiredState = 'active' | 'hibernated' | 'destroyed';

/**
 * What the platform last saw of an active resource's instance. `restoring` is
 * an instance that came back empty and is being refilled from its snapshot;
 * searches return `capacity_restoring` until it is `ready`.
 */
export type InfraHealth = 'ready' | 'not-ready' | 'missing' | 'restoring';

/** A leasable product from the platform catalog. Prices are cogs + margin. */
export interface InfraOffering {
  id: string;
  kind: 'retrieval';
  /** User-facing size, e.g. "Small". */
  label: string;
  /** User-facing capacity, e.g. "Up to ~1M chunks". */
  description: string;
  hourlyPriceDollars: number;
  /** Hourly × 730. */
  monthlyPriceDollars: number;
  /** Retained-storage rate while hibernated. */
  hibernatedHourlyPriceDollars: number;
  hibernatedMonthlyPriceDollars: number;
  capacity: { maxPoints: number };
  capabilities: { hibernate: boolean };
  retired: boolean;
}

export interface InfraResource {
  id: string;
  appId: string;
  name: string;
  kind: 'retrieval';
  offeringId: string;
  offering: InfraOffering | null;
  phase: InfraPhase;
  desiredState: InfraDesiredState;
  /** Data sources placed on this resource. Destroy is refused while > 0. */
  attachedSources: number;
  lastError: string | null;
  /** Null until the instance exists (requested, hibernated, destroyed). */
  health: InfraHealth | null;
  /**
   * What the instance is doing right now, while a transition is under way
   * ("Waiting for capacity", "Snapshotting ds_x (1/2)"); null when nothing is.
   */
  detail: string | null;
  /** When the last verified snapshot was taken; null if never. */
  lastSnapshotAt: string | null;
  activatedAt: string | null;
  hibernatedAt: string | null;
  destroyedAt: string | null;
  phaseChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InfraEvent {
  id: string;
  fromPhase: InfraPhase | null;
  toPhase: InfraPhase;
  /** `user:<id>` or `system`. */
  actor: string;
  reason: string | null;
  createdAt: string;
}

/** GET /infra */
export interface InfraListResult {
  resources: InfraResource[];
  offerings: InfraOffering[];
  /** False on hosts that cannot provision; `provision` will be refused. */
  provisioningAvailable: boolean;
}

/** GET /infra/:id */
export interface InfraGetResult {
  resource: InfraResource;
  events: InfraEvent[];
  attachedSources: { id: string; slug: string; name: string | null }[];
}

/** POST /infra, /infra/:id/{hibernate,resume,destroy,rename} */
export interface InfraResourceResult {
  resource: InfraResource;
}
