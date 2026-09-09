/**
 * One shape for every long operation's progress: a bulk load, an index
 * reload, a move, an index build, a resource changing phase. Rate and ETA are
 * measured by the platform from the operation's own record, so the CLI, the
 * dashboard and a search's refusal message quote the same numbers.
 *
 * Transcribed from youai-api: src/common/DataSources/progress.ts
 */
export interface OperationProgress {
  /** The operation's own phase word: `running`, `copying`, `building`, `provisioning`… */
  phase: string;
  unit: 'documents' | 'objects' | 'vectors' | 'steps';
  done: number;
  /** Null when the operation has no known end (a planning walk, a phase transition). */
  total: number | null;
  /** Units per minute over the last few minutes; null until measured. */
  ratePerMinute: number | null;
  /** When the rest lands at that rate; null without a rate or a total. */
  etaAt: string | null;
  startedAt: string | null;
  /** When the operation last moved. */
  updatedAt: string | null;
  /** No movement for 30 minutes while under way. */
  stalled: boolean;
  /** The operation's own word on itself: an error, a pause reason, a step. */
  note: string | null;
  history: { phase: string; at: string }[];
}
