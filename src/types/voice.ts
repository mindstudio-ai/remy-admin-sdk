/**
 * Response types for the v2 voice endpoints (sessions, settings, phone numbers).
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/voiceSessions.ts       — sessions + settings routes
 *   src/http/routes/V2Apps/manage/voicePhoneNumbers.ts   — phone-number routes
 *   src/common/Db/v2Apps/V2VoiceSessionsDao.ts           — session shapes
 *   src/common/Db/v2Apps/V2VoiceSettingsDao.ts           — V2VoiceSettings
 *   src/common/Db/v2Apps/voiceUsageBilling.ts            — cost breakdown types
 *   src/common/Db/v2Apps/V2VoicePhoneNumbersDao.ts       — VoicePhoneNumber
 *   src/common/Telnyx/TelnyxNumbersService.ts            — availableNumberToView
 *   src/http/routes/V2Apps/serve/voice/_helpers/policy.ts — ResolvedVoicePolicy
 */

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export type VoicePhoneNumberStatus =
  'pending' | 'active' | 'failed' | 'released';

/** One dedicated phone number as returned by the phone-number endpoints. */
export interface VoicePhoneNumberView {
  id: string;
  /** E.164 number, e.g. `+13105551234`. */
  e164: string;
  status: VoicePhoneNumberStatus;
  locality: string | null;
  administrativeArea: string | null;
  /** Outbound CNAM caller-ID name last pushed to Telnyx; null = unlisted. */
  cnamListing: string | null;
  /** Monthly cost from the carrier as a decimal string (e.g. `"1.00000"`). */
  carrierMonthlyCost: string | null;
  /** Platform rental price in USD/month billed to the workspace. */
  monthlyPriceDollars: number;
  /** ISO timestamp. */
  createdAt: string;
}

/** One available number returned by a Telnyx availability search. */
export interface VoiceAvailableNumber {
  phoneNumber: string;
  locality: string | null;
  administrativeArea: string | null;
  /** Telnyx monthly cost as a decimal string; null if not provided. */
  monthlyCost: string | null;
  upfrontCost: string | null;
  /** Currency code, typically 'USD'. */
  currency: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type VoiceSessionStatus = 'active' | 'ended' | 'failed';
export type VoiceSessionChannel = 'web' | 'phone-out' | 'phone-in';

/** Telephony call-endpoint snapshot for phone-in / phone-out sessions. */
export interface VoiceSessionSip {
  to: string;
  fromNumber: string;
}

/** A spoken turn committed from the worker's conversation events. */
export interface VoiceSessionSpeechEntry {
  role: 'user' | 'assistant';
  text: string;
  interrupted?: boolean;
  /** Milliseconds since epoch. */
  at: number;
}

/**
 * A tool round on the transcript timeline. Fast/slow tools emit one entry on
 * completion; background tools emit two: 'dispatched' + 'done'/'failed'.
 */
export interface VoiceSessionToolEntry {
  kind: 'tool';
  method: string;
  latency: 'fast' | 'slow' | 'background' | 'client';
  status: 'dispatched' | 'done' | 'failed';
  at: number;
  durationMs?: number;
  argsPreview?: string;
  resultPreview?: string;
}

export type VoiceSessionTranscriptEntry =
  VoiceSessionSpeechEntry | VoiceSessionToolEntry;

/** One item in the sessions list (transcript excluded for performance). */
export interface VoiceSessionListItem {
  id: string;
  status: VoiceSessionStatus;
  channel: VoiceSessionChannel;
  sip: VoiceSessionSip | null;
  /** ISO timestamp. */
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  endedReason: string | null;
  userId: string | null;
  visitorId: string;
  /** Non-null identifies a builder test call through the dev tunnel. */
  devSessionId: string | null;
  userName: string | null;
  userEmail: string | null;
}

/** One line in the session cost breakdown. */
export interface VoiceSessionCostLine {
  eventType: string;
  label: string;
  numUnits: number;
  unit: 'tokens' | 'seconds' | 'minutes' | 'characters' | 'units';
  /** Nano-dollar credits (same units as the ledger's billedAmount). */
  credits: number;
}

/** Cost breakdown appended by the route to a finished session; null while active. */
export interface VoiceSessionCost {
  lines: VoiceSessionCostLine[];
  totalCredits: number;
}

/** Full session with transcript and cost breakdown (single-session GET). */
export interface VoiceSessionDetail {
  id: string;
  appId: string;
  userId: string | null;
  organizationId: string;
  visitorId: string;
  releaseId: string | null;
  devSessionId: string | null;
  roomName: string;
  status: VoiceSessionStatus;
  channel: VoiceSessionChannel;
  sip: VoiceSessionSip | null;
  /** ISO timestamp. */
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
  endedReason: string | null;
  durationSecs: number | null;
  /** Engine config the session ran with (verbatim from the release manifest). */
  model: Record<string, unknown>;
  transcript: VoiceSessionTranscriptEntry[];
  /** Per-provider model usage snapshot from the worker (billing input). */
  usage: Record<string, unknown>;
  billedAt: string | null;
  userName: string | null;
  userEmail: string | null;
  dateCreated: string;
  dateUpdated: string;
  /** Cost breakdown; null for sessions that are still active. */
  cost: VoiceSessionCost | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Owner-set policy overrides. All fields are optional — absent = use the
 * platform default. Values are clamped to the platform ceilings at session mint.
 */
export interface VoiceSettingsOverrides {
  maxConcurrentSessions?: number;
  maxConcurrentSessionsPerVisitor?: number;
  maxSessionDurationSecs?: number;
}

/** Effective (default-filled + ceiling-clamped) session policy. */
export interface VoiceResolvedPolicy {
  maxConcurrentSessions: number;
  maxConcurrentSessionsPerVisitor: number;
  maxSessionDurationSecs: number;
}

/** Platform ceiling values — app overrides are clamped to these at mint. */
export interface VoiceSettingsCeilings {
  maxConcurrentSessions: number;
  maxConcurrentSessionsPerVisitor: number;
  maxSessionDurationSecs: number;
}

// ---------------------------------------------------------------------------
// Endpoint responses
// ---------------------------------------------------------------------------

/** GET /_internal/v2/apps/:appId/settings/voice-phone-numbers */
export interface VoiceNumbersListResult {
  numbers: VoicePhoneNumberView[];
  /** Platform rental price in USD/month (same for all numbers). */
  monthlyPriceDollars: number;
}

/** POST /_internal/v2/apps/:appId/settings/voice-phone-numbers/search */
export interface VoiceNumbersSearchResult {
  results: VoiceAvailableNumber[];
}

/** POST /_internal/v2/apps/:appId/settings/voice-phone-numbers — buy */
export interface VoiceNumbersBuyResult {
  number: VoicePhoneNumberView;
}

/** POST /_internal/v2/apps/:appId/settings/voice-phone-numbers/:id/release */
export interface VoiceNumbersReleaseResult {
  number: VoicePhoneNumberView;
}

/** POST /_internal/v2/apps/:appId/settings/voice-phone-numbers/:id/display-name */
export interface VoiceNumbersSetNameResult {
  number: VoicePhoneNumberView;
}

/** GET /_internal/v2/apps/:appId/voice-sessions */
export interface VoiceSessionsListResult {
  sessions: VoiceSessionListItem[];
  nextCursor: string | null;
}

/** GET /_internal/v2/apps/:appId/voice-sessions/:sessionId */
export type VoiceSessionGetResult = VoiceSessionDetail;

/** GET /_internal/v2/apps/:appId/voice-settings */
export interface VoiceSettingsGetResult {
  settings: VoiceSettingsOverrides;
  effective: VoiceResolvedPolicy;
  ceilings: VoiceSettingsCeilings;
}

/** PUT /_internal/v2/apps/:appId/voice-settings */
export interface VoiceSettingsSetResult {
  settings: VoiceSettingsOverrides;
  effective: VoiceResolvedPolicy;
}
