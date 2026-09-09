/**
 * Response types for the provisioned-infrastructure management API.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/provisionedResources.ts
 *   src/common/Provisioning/types.ts
 *   src/common/Provisioning/offerings/define.ts
 */

import type { OperationProgress } from './progress.js';

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
 * What the platform last saw of an active resource's instance. `rebuilding`
 * is a serving instance onto which one or more placed sources are being copied
 * back from durable storage (a new pod found their index empty); searches on
 * those sources answer `index_warming` with the copy's progress until it lands.
 */
export type InfraHealth = 'ready' | 'not-ready' | 'missing' | 'rebuilding';

/** A leasable product from the platform catalog. Prices are cogs + margin. */
export interface InfraOffering {
  id: string;
  kind: 'retrieval';
  /** User-facing size, e.g. "Small". */
  label: string;
  /** User-facing capacity, e.g. "Up to ~34M chunks at 2560 dimensions (~48M at 1024, ~26M at 4096)". */
  description: string;
  hourlyPriceDollars: number;
  /** Hourly × 730. */
  monthlyPriceDollars: number;
  /** Zero: a hibernated resource holds nothing; its sources' documents stay in the platform's own store. */
  hibernatedHourlyPriceDollars: number;
  hibernatedMonthlyPriceDollars: number;
  /**
   * What the size holds: its disk and RAM, and the chunks that comes to at
   * each embedding dimension on offer, keyed by dimension ("2560"). A chunk
   * embedded at 2560 dimensions takes two and a half times a 1024-dimension
   * one, so a resource's room depends on what is placed on it.
   */
  capacity: {
    diskGiB: number;
    memoryGiB: number;
    chunksByDimensions: Record<string, number>;
  };
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
   * ("Waiting for capacity", "Starting Qdrant", "Scaling down"); null when nothing is.
   */
  detail: string | null;
  /**
   * The same in the one progress shape, with numbers where there are any: a
   * rebuild of the sources placed here (documents, rate, ETA), an index build
   * the optimizer is behind on (vectors), or a transition's step. Null when the
   * resource is simply serving.
   */
  progress: OperationProgress | null;
  /**
   * What the sources placed here take on the instance, estimated from their
   * chunk counts at their dimensions, against what the size can hold
   * (`usableDiskBytes`). `storedBytes` is the vectors and payload the instance
   * itself reports (null until it has); the indexes and WAL sit on top of it,
   * so it runs under the estimate. Null when the offering is unknown.
   */
  footprint: {
    chunks: number;
    estimatedDiskBytes: number;
    storedBytes: number | null;
    measuredAt: string | null;
    usableDiskBytes: number;
  } | null;
  /**
   * The size this resource is being resized to, while a resize is under way;
   * null otherwise. A resize passes through `hibernated` and back to the phase
   * it started from.
   */
  resizingTo: InfraOffering | null;
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
 * a transition ran ("Waiting for capacity", "Starting Qdrant"), a rebuild it
 * started ("Instance replaced; checking each placed source's index on it"), a
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
