/**
 * Agent-chat thread log operations.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling — the CLI skin in
 * commands/agent.ts and the importable client both call these.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  AgentThreadsListResult,
  AgentThreadsGetResult,
} from '../types/agent.js';

export interface ThreadsListParams {
  /** Max threads per page (default 20, server clamps to 100). */
  limit?: number;
  /** Pagination cursor from a prior page's `nextCursor`. */
  cursor?: string;
}

/**
 * Every conversation the app's agent has had, newest activity first.
 *
 * Returns cursored pages; pass `nextCursor` from one page as `cursor` for the
 * next. Transcripts are not included — fetch a thread with `threadsGet`.
 *
 * `toolErrorCount` and `hasTurnError` are how you find the conversations worth
 * reading, and `devSession` separates your own test threads from real traffic.
 *
 * @example
 * const { threads } = await admin.agent.threadsList({ limit: 20 });
 * const broken = threads.filter((t) => t.toolErrorCount > 0 || t.hasTurnError);
 */
export function threadsList(ctx: AdminContext, params: ThreadsListParams = {}) {
  return call<AgentThreadsListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/agent-threads${qs(params)}`,
  );
}

/**
 * One thread with its full transcript: what the user said, what the agent
 * replied, which tools it called with which arguments, and what came back.
 *
 * This is the primary tool for iterating on an agent's system prompt and tool
 * descriptions — read what actually happened rather than guessing. Each method
 * tool call carries a `requestId`; pass it to `requests.get()` for that call's
 * input, output, stdout and error.
 *
 * @throws AdminApiError `thread_not_found` (404).
 * @example
 * const thread = await admin.agent.threadsGet('4f6c…');
 * console.log(thread.messages);
 */
export function threadsGet(ctx: AdminContext, threadId: string) {
  return call<AgentThreadsGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/agent-threads/${seg(threadId)}`,
  );
}
