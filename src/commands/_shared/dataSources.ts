/**
 * What every `datasources …` command file shares: the default source, the
 * `--timeout` flag, and the one way a `--wait` ends (print the result, then
 * an exit code the agent can branch on).
 */

import type { Args } from '../../args.js';
import type { AdminContext } from '../../ctx.js';
import { CliError, EXIT } from '../../errors.js';
import * as jobs from '../../ops/dataSourceJobs.js';
import { out, progress } from '../../output.js';

export const DEFAULT_SOURCE = 'default';

export const sourceOf = (a: Args) => a.str('source') || DEFAULT_SOURCE;

/** `--timeout <sec>` as the ops' `timeoutMs`, when given. */
export const timeoutOf = (a: Args) => {
  const seconds = a.str('timeout');
  return seconds ? { timeoutMs: Number(seconds) * 1000 } : {};
};

/**
 * The exit code of a settled wait. 1 when the thing failed, paused, was
 * cancelled, or (a job) sits in `planned` with nothing about to run it; 2 on
 * timeout. Anything else is done.
 */
export function failOnWait(result: { status: string; error?: string }): void {
  if (result.status === 'timeout') {
    throw new CliError(result.error ?? 'Timed out.', EXIT.timeout);
  }
  if (result.status === 'failed' || result.status === 'error') {
    throw new CliError(result.error ?? 'Failed.', EXIT.buildFailed);
  }
  if (result.status === 'planned') {
    throw new CliError(
      `${result.error ?? 'The plan is ready but the job did not start.'} Fix the cause, then \`datasources jobs approve <id>\`.`,
      EXIT.buildFailed,
    );
  }
}

/** Block on a job and print the outcome, then exit by `failOnWait`. */
export async function waitAndReport(
  ctx: AdminContext,
  a: Args,
  id: string,
  mode: 'plan' | 'job',
  summary: Record<string, unknown>,
): Promise<void> {
  const wait = mode === 'plan' ? jobs.waitForPlan : jobs.waitForJob;
  const result = await wait(ctx, { id, ...timeoutOf(a), onProgress: progress });
  out({ ...summary, ...result });
  failOnWait(result);
}
