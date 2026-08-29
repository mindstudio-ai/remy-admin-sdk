/**
 * Voice operations: phone numbers, sessions, and policy settings.
 *
 * `findNumberId` resolves a user-supplied E.164 string to a row id (list →
 * normalize → match). It throws a plain Error with the exact historical
 * message if not found — entry-point catch prints it identically to `fatal()`.
 *
 * Ops are pure: (ctx, params) → typed result, throwing AdminApiError /
 * AdminTimeoutError. No printing, no process coupling.
 */

import type { AdminContext } from '../ctx.js';
import { call, qs, seg } from '../http.js';
import type {
  VoiceNumbersListResult,
  VoiceNumbersSearchResult,
  VoiceNumbersBuyResult,
  VoiceNumbersReleaseResult,
  VoiceNumbersSetNameResult,
  VoiceSessionsListResult,
  VoiceSessionGetResult,
  VoiceSettingsGetResult,
  VoiceSettingsSetResult,
} from '../types/voice.js';

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Canonicalize a user-typed phone number to E.164 before matching: strip
 * formatting, accept bare 10/11-digit US numbers.
 */
function normalizeE164(input: string): string {
  const stripped = input.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(stripped)) {
    return `+1${stripped}`;
  }
  if (/^1\d{10}$/.test(stripped)) {
    return `+${stripped}`;
  }
  return stripped;
}

/**
 * All dedicated phone numbers attached to the app.
 *
 * Lazily reconciles any pending orders so callers can poll this until a
 * `pending` number converges to `active` or `failed`.
 *
 * @example
 * const { numbers } = await admin.voice.numbersList();
 * const active = numbers.filter((n) => n.status === 'active');
 */
export function numbersList(ctx: AdminContext) {
  return call<VoiceNumbersListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/settings/voice-phone-numbers`,
  );
}

export interface NumbersSearchParams {
  /** US 3-digit area code to filter by. */
  areaCode?: string;
  /** City name to filter by. */
  locality?: string;
  /** State or region code (e.g. `CA`). */
  administrativeArea?: string;
  /** Max results to return (server clamps to 50). */
  limit?: number;
}

/**
 * Search available US numbers by area code or locality.
 *
 * Results are Telnyx availability snapshots — they are not reservations and
 * may be gone by the time `numbersBuy` is called.
 *
 * @throws AdminApiError `missing_search_filter` (400) — neither areaCode nor
 *   locality provided; `invalid_area_code` (400) — area code is not 3 digits;
 *   `telnyx_not_configured` (422) — phone numbers are not available on this
 *   platform host.
 * @example
 * const { results } = await admin.voice.numbersSearch({ areaCode: '310', limit: 5 });
 */
export function numbersSearch(ctx: AdminContext, params: NumbersSearchParams) {
  return call<VoiceNumbersSearchResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/voice-phone-numbers/search`,
    {
      areaCode: params.areaCode,
      locality: params.locality,
      administrativeArea: params.administrativeArea,
      limit: params.limit,
    },
  );
}

export interface NumbersBuyParams {
  /** E.164 US number to purchase, from a prior `numbersSearch` result. */
  phoneNumber: string;
  /** City name label — display metadata only, echoed from the search result. */
  locality?: string;
  /** State/region label — display metadata only, echoed from the search result. */
  administrativeArea?: string;
  /** Carrier monthly cost string (e.g. `"1.00000"`) — display metadata only. */
  monthlyCost?: string;
}

/**
 * Buy and attach a dedicated phone number to the app ($1/month billed to the
 * workspace starting immediately — always confirm with the user before calling).
 *
 * The number is both the outbound caller-ID for `voice.call()` and the app's
 * inbound line. A `pending` status usually activates within seconds; poll
 * `numbersList` to confirm. One number per app in v1 — release before switching.
 *
 * @throws AdminApiError `invalid_phone_number` (400) — not a valid +1 E.164
 *   US number; `number_already_assigned` (422) — this app already has a live
 *   number; `number_unavailable` (422) — the number is no longer available;
 *   `insufficient_credits` (402) — the workspace balance is too low;
 *   `telnyx_not_configured` (422) — phone numbers unavailable on this host.
 * @example
 * const { number } = await admin.voice.numbersBuy({
 *   phoneNumber: '+13105551234',
 *   locality: 'Los Angeles',
 *   administrativeArea: 'CA',
 *   monthlyCost: '1.00000',
 * });
 */
export function numbersBuy(ctx: AdminContext, params: NumbersBuyParams) {
  return call<VoiceNumbersBuyResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/voice-phone-numbers`,
    {
      phoneNumber: params.phoneNumber,
      locality: params.locality,
      administrativeArea: params.administrativeArea,
      monthlyCost: params.monthlyCost,
    },
  );
}

/**
 * Resolve a phone-number row id from its E.164 value by listing and matching.
 * Throws with the exact historical message if not found.
 */
async function findNumberId(ctx: AdminContext, e164: string): Promise<string> {
  const normalized = normalizeE164(e164);
  const res = await numbersList(ctx);
  const entry = (res.numbers ?? []).find((n) => n.e164 === normalized);
  if (!entry) {
    throw new Error(`No phone number "${e164}" on this app`);
  }
  return entry.id;
}

/**
 * Release a dedicated phone number from the app (permanent).
 *
 * The monthly rental stops immediately (no refund for the current month),
 * the carrier quarantines the number for ~15 days, and both inbound calls
 * and outbound `voice.call()` stop working until a new number is attached.
 *
 * @param e164 The phone number in E.164 or bare 10-digit US format.
 * @throws Error `No phone number "${e164}" on this app` when not found;
 *   AdminApiError `number_not_found` (404) if the resolved id has gone stale;
 *   `order_in_progress` (422) — the purchase is still settling, try again in
 *   a minute.
 * @example
 * await admin.voice.numbersRelease('+13105551234');
 */
export async function numbersRelease(ctx: AdminContext, e164: string) {
  const id = await findNumberId(ctx, e164);
  return call<VoiceNumbersReleaseResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/voice-phone-numbers/${seg(id)}/release`,
  );
}

/**
 * Set or clear the outbound caller-ID display name (CNAM) for a phone number.
 *
 * CNAM must be 1–15 letters, numbers, or spaces; carrier propagation takes
 * 12–72 hours and display is ultimately the receiving carrier's call. Pass an
 * empty string to remove the listing.
 *
 * @param e164 The phone number in E.164 or bare 10-digit US format.
 * @param displayName 1–15 character CNAM string, or `""` to remove the listing.
 * @throws Error `No phone number "${e164}" on this app` when not found;
 *   AdminApiError `number_not_found` (404) if the resolved id has gone stale;
 *   `number_not_active` (422) — the number must be active before setting a
 *   display name; `invalid_display_name` (400) — value is not 1–15 letters,
 *   numbers, or spaces.
 * @example
 * await admin.voice.numbersSetName('+13105551234', 'Acme Corp');
 * // Clear the listing:
 * await admin.voice.numbersSetName('+13105551234', '');
 */
export async function numbersSetName(
  ctx: AdminContext,
  e164: string,
  displayName: string,
) {
  const id = await findNumberId(ctx, e164);
  return call<VoiceNumbersSetNameResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/settings/voice-phone-numbers/${seg(id)}/display-name`,
    { displayName },
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionsListParams {
  /** Max sessions per page (default 20, server clamps to 100). */
  limit?: number;
  /** Pagination cursor from a prior page's `nextCursor`. */
  cursor?: string;
}

/**
 * Call log for the app (web, phone-out, phone-in sessions), newest first.
 *
 * Returns cursored pages; pass `nextCursor` from one page as `cursor` for the
 * next. Transcripts are not included — fetch a session with `sessionsGet` for
 * the full transcript.
 *
 * @example
 * const { sessions, nextCursor } = await admin.voice.sessionsList({ limit: 20 });
 */
export function sessionsList(
  ctx: AdminContext,
  params: SessionsListParams = {},
) {
  return call<VoiceSessionsListResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/voice-sessions${qs(params as Record<string, string | number | boolean | undefined | null>)}`,
  );
}

/**
 * One voice session with full transcript and cost breakdown.
 *
 * `transcript` is the primary tool for debugging and iterating on a voice
 * persona. `cost` is `null` while the session is still active.
 *
 * @throws AdminApiError `session_not_found` (404).
 * @example
 * const session = await admin.voice.sessionsGet('4f6c…');
 * console.log(session.transcript);
 */
export function sessionsGet(ctx: AdminContext, sessionId: string) {
  return call<VoiceSessionGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/voice-sessions/${seg(sessionId)}`,
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Voice policy for the app: owner-set overrides, the effective (default-filled
 * and ceiling-clamped) values that apply at session mint, and the platform
 * ceilings.
 *
 * @example
 * const { settings, effective, ceilings } = await admin.voice.settingsGet();
 */
export function settingsGet(ctx: AdminContext) {
  return call<VoiceSettingsGetResult>(
    ctx,
    'GET',
    `/_internal/v2/apps/${ctx.appId}/voice-settings`,
  );
}

export interface VoiceSettingsSetParams {
  /** Cap on simultaneous sessions across all visitors (platform ceiling applies). */
  maxConcurrentSessions?: number;
  /** Cap on simultaneous sessions per visitor. */
  maxConcurrentSessionsPerVisitor?: number;
  /** Max session duration in seconds before the session is terminated. */
  maxSessionDurationSecs?: number;
}

/**
 * Override one or more voice-policy settings for the app (merge semantics —
 * fields you omit keep their current values).
 *
 * @throws AdminApiError `invalid_voice_settings` (400) — a field value is not
 *   a positive number.
 * @example
 * await admin.voice.settingsSet({ maxConcurrentSessions: 5, maxSessionDurationSecs: 600 });
 */
export function settingsSet(ctx: AdminContext, params: VoiceSettingsSetParams) {
  return call<VoiceSettingsSetResult>(
    ctx,
    'PUT',
    `/_internal/v2/apps/${ctx.appId}/voice-settings`,
    {
      maxConcurrentSessions: params.maxConcurrentSessions,
      maxConcurrentSessionsPerVisitor: params.maxConcurrentSessionsPerVisitor,
      maxSessionDurationSecs: params.maxSessionDurationSecs,
    },
  );
}
