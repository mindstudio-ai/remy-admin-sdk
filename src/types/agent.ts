/**
 * Response types for the v2 agent-chat thread log.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/agentThreads.ts                    — routes
 *   src/http/routes/V2Apps/manage/_helpers/projectAgentMessages.ts   — transcript shape
 *   src/common/Db/v2Apps/V2AgentThreadsDao.ts                        — list row shape
 */

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/** One tool the assistant asked for, with the arguments it chose. */
export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A platform/model failure that ended a turn instead of a reply. */
export interface AgentTurnError {
  message: string;
  code?: string;
  /** Milliseconds since epoch. */
  at: number;
}

/**
 * One message in a thread transcript.
 *
 * Roles are the stored conversation's own: `user` for a person's message AND
 * for a tool result (which carries `toolCallId`), `assistant` for the agent.
 */
export interface AgentTranscriptMessage {
  role: string;
  content: string;
  /** CDN URLs the user attached (user messages only). */
  attachments?: string[];
  /** Present on an assistant message that requested tools. */
  toolCalls?: AgentToolCall[];
  /** Present on a tool result — matches the `toolCalls[].id` it answers. */
  toolCallId?: string;
  /** The tool reported a failure. */
  isToolError?: boolean;
  /**
   * Request-log id for a method tool call — `requests get <id>` for its input,
   * output, stdout and error. Absent on client-tool results, which run in the
   * browser and never reach the backend.
   */
  requestId?: string;
  /** The turn ended in a platform/model failure rather than a reply. */
  turnError?: AgentTurnError;
  /**
   * The model saw extracted document text from an attachment on top of
   * `content`. Only its presence is reported — the text can run to megabytes.
   */
  hasProcessedContent?: true;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** One item in the thread list (transcript excluded). */
export interface AgentThreadListItem {
  id: string;
  /** Auto-generated from the first user message, or renamed by the user. */
  title: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  /** Browser identity — the only id an anonymous conversation has. */
  visitorId: string | null;
  /** True identifies a builder test conversation through the dev tunnel. */
  devSession: boolean;
  messageCount: number;
  /** Tool results reported as failures — the conversations worth opening. */
  toolErrorCount: number;
  /** A turn broke (model error, rate limit, credits) rather than replying. */
  hasTurnError: boolean;
  /** ISO timestamp. */
  dateCreated: string;
  dateUpdated: string;
}

/** Full thread with transcript (single-thread GET). */
export interface AgentThreadDetail {
  id: string;
  title: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  visitorId: string | null;
  devSession: boolean;
  messageCount: number;
  /** ISO timestamp. */
  dateCreated: string;
  dateUpdated: string;
  messages: AgentTranscriptMessage[];
}

/** GET /_internal/v2/apps/:appId/agent-threads */
export interface AgentThreadsListResult {
  threads: AgentThreadListItem[];
  nextCursor: string | null;
}

/** GET /_internal/v2/apps/:appId/agent-threads/:threadId */
export type AgentThreadsGetResult = AgentThreadDetail;
