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
   * ("Waiting for capacity", "Snapshotting collection 1/2"); null when nothing is.
   */
  detail: string | null;
  /**
   * The size this resource is being resized to, while a resize is under way;
   * null otherwise. A resize passes through `hibernated` and back to the phase
   * it started from.
   */
  resizingTo: InfraOffering | null;
  /** When the last verified snapshot was taken; null if never. */
  lastSnapshotAt: string | null;
  /**
   * What this resource has actually been charged, from the ledger's own
   * writes, with the hours at each rate beside it. Rates are on `offering`.
   */
  billing: {
    activeHours: number;
    hibernatedHours: number;
    billedDollars: number;
    lastBilledAt: string | null;
  };
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

/**
 * One line of the platform's narration of a resource: a step reported while
 * a transition ran ("Waiting for capacity", "Restoring collections 2/3"), a
 * failed attempt, or a failure with what Kubernetes said about the pod at the
 * time (`data`). Not the instance's own stdout.
 */
export interface InfraLogLine {
  id: string;
  phase: InfraPhase;
  level: 'info' | 'warn' | 'error';
  message: string;
  data: { podEvents: string[]; logTail: string[] } | null;
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
  /** The newest 200 narration lines, oldest first; `logs()` pages further. */
  logs: InfraLogLine[];
  attachedSources: { id: string; slug: string; name: string | null }[];
}

/** GET /infra/:id/logs */
export interface InfraLogsResult {
  /** Oldest first. */
  logs: InfraLogLine[];
}

/** POST /infra, /infra/:id/{hibernate,resume,destroy,rename,resize} */
export interface InfraResourceResult {
  resource: InfraResource;
}
