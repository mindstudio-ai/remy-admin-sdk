/**
 * The one polling loop under every `--wait`: read the thing, ask whether it
 * has settled, sleep, repeat, with a bounded grace for gateway errors and a
 * timeout. The waits differ only in what they read, what "settled" means and
 * how they describe progress; none of them owns a loop.
 */

import { isTransientError, TRANSIENT_GRACE_MS } from './http.js';
import { sleep } from './sleep.js';

export interface PollOptions<T> {
  /**
   * How long the thing may go WITHOUT MOVING before the wait gives up. With
   * `progressKey`, every change of the key restarts this clock, so an
   * operation of any length is waited out as long as it keeps moving and the
   * timeout bounds silence, not duration. Without it, the whole wait.
   */
  timeoutMs: number;
  pollMs: number;
  /** One line of progress for a value that has not settled; `start` is when the wait began. */
  describe?: (value: T, start: number) => string;
  /** Something that changes when the operation moves: a count, a phase, a timestamp. */
  progressKey?: (value: T) => string | number | null | undefined;
  onProgress?: (message: string) => void;
}

export type PollOutcome<T> =
  { settled: true; value: T } | { settled: false; value: T };

/**
 * Poll `read` until `isSettled` says so or the timeout elapses. A wait can run
 * for minutes through a tunnel; one gateway error is not an answer about the
 * thing being waited on, so it is retried for `TRANSIENT_GRACE_MS` before it
 * counts. Any other error propagates.
 */
export async function pollUntil<T>(
  read: () => Promise<T>,
  isSettled: (value: T) => boolean,
  options: PollOptions<T>,
): Promise<PollOutcome<T>> {
  const start = Date.now();
  let movedAt = start;
  let lastKey: string | number | null | undefined;
  let transientSince: number | null = null;

  while (true) {
    let value: T;
    try {
      value = await read();
      transientSince = null;
    } catch (err) {
      if (!isTransientError(err)) {
        throw err;
      }
      transientSince ??= Date.now();
      if (Date.now() - transientSince > TRANSIENT_GRACE_MS) {
        throw err;
      }
      options.onProgress?.(
        `retrying after a gateway error… (${elapsedSeconds(start)}s)`,
      );
      await sleep(options.pollMs);
      continue;
    }

    if (isSettled(value)) {
      return { settled: true, value };
    }
    if (options.progressKey) {
      const key = options.progressKey(value);
      if (key !== lastKey) {
        lastKey = key;
        movedAt = Date.now();
      }
    }
    if (Date.now() - movedAt > options.timeoutMs) {
      return { settled: false, value };
    }
    if (options.describe) {
      options.onProgress?.(options.describe(value, start));
    }
    await sleep(options.pollMs);
  }
}

export function elapsedSeconds(start: number): number {
  return Math.round((Date.now() - start) / 1000);
}

/** The standard timeout line: how long, and where the thing still is. */
export function timedOut(timeoutMs: number, still: string): string {
  return `Timed out after ${Math.round(timeoutMs / 1000)}s ${still}`;
}
