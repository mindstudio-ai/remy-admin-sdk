/**
 * The CLI's output contract, both halves in one place:
 * results and errors go to stdout as JSON, human progress goes to stderr.
 *
 * That split is what lets a caller pipe stdout straight into a JSON parser
 * while a person watching a long poll still sees something happen.
 */

import { elapsedSeconds } from './poll.js';
import type { OperationProgress } from './types/progress.js';

/**
 * Compact JSON for machine callers, indented for a human at a terminal. remy
 * always reads this through a pipe, so it gets one JSON value per line — which
 * is what makes `--stream` output parseable line by line.
 */
const PRETTY = process.stdout.isTTY === true;

export function out(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, PRETTY ? 2 : 0)}\n`);
}

/** Progress to stderr so stdout stays a clean stream of JSON values. */
export function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** "about 12 min left" or "about 2.5 h left"; null without an ETA. */
export function describeEta(
  eta: string | null,
  now = Date.now(),
): string | null {
  if (!eta) {
    return null;
  }
  const minutes = Math.max(1, Math.round((Date.parse(eta) - now) / 60_000));
  if (minutes < 90) {
    return `about ${minutes} min left`;
  }
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `about ${hours} h left`;
}

/**
 * The one progress line every `--wait` prints: the operation's phase, its
 * count, the platform's measured rate and ETA, and how long this wait has run.
 * `extra` is the operation's own addendum (a job's spend, say).
 */
export function renderProgress(
  p: OperationProgress,
  start?: number,
  extra?: string | null,
): string {
  const count =
    p.total !== null
      ? `${p.done.toLocaleString()}/${p.total.toLocaleString()} ${p.unit}`
      : p.done > 0
        ? `${p.done.toLocaleString()} ${p.unit}`
        : null;
  const rate =
    p.ratePerMinute !== null && p.ratePerMinute > 0
      ? `${Math.round(p.ratePerMinute).toLocaleString()}/min`
      : null;
  const parts = [
    `${p.phase}…`,
    count,
    rate,
    describeEta(p.etaAt),
    extra ?? null,
    p.stalled ? 'no progress for 30 min' : null,
  ].filter((part): part is string => Boolean(part));
  const elapsed = start !== undefined ? ` (${elapsedSeconds(start)}s)` : '';
  return `${parts.join(' · ')}${elapsed}`;
}
