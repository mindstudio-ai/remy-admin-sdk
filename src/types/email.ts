/**
 * Response shapes for the email command group — transcribed from youai-api.
 *
 * Sources:
 *   src/http/routes/V2Apps/manage/outboundEmail.ts
 *   src/http/routes/V2Apps/manage/outboundEmailDomains.ts
 *   src/http/routes/V2Apps/manage/emailDomains.ts
 *   src/http/routes/V2Apps/manage/requestLog.ts (inbox route only)
 *   src/common/Db/v2Apps/V2EmailMessagesDao/index.ts
 *   src/common/Db/v2Apps/AppEmailSuppressionsDao/index.ts
 *   src/common/Aws/SesIdentityService.ts
 *   src/common/Db/v2Apps/RequestLogDao.ts
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Per-recipient outbound delivery status. */
export type EmailMessageStatus =
  | 'suppressed'
  | 'failed'
  | 'sent'
  | 'delivered'
  | 'blocked'
  | 'bounced'
  | 'complained'
  | 'delayed'
  | 'rejected';

/** Origin of the outbound message. */
export type EmailMessageKind = 'method' | 'auth';

/** How the address ended up suppressed. */
export type SuppressionSource = 'one_click' | 'link' | 'owner' | 'complaint';

// ---------------------------------------------------------------------------
// Core row shapes
// ---------------------------------------------------------------------------

/** Full row from v2_email_messages (V2EmailMessagesDao.get / .list). */
export interface V2EmailMessage {
  id: string;
  appId: string;
  recipient: string;
  sesMessageId: string | null;
  status: EmailMessageStatus;
  category: string;
  kind: EmailMessageKind;
  subject: string | null;
  fromAddress: string | null;
  methodId: string | null;
  requestLogId: string | null;
  /** Blast this row belongs to; null for sign-in codes and pre-batch rows. */
  batchId: string | null;
  diagnostic: Record<string, unknown> | null;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  delayedAt: string | null;
  rejectedAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

/** Aggregate stats over a time window (V2EmailMessagesDao.summary). */
export interface EmailSummary {
  counts: Record<EmailMessageStatus, number>;
  /** Messages SES accepted — the denominator for every rate below. */
  accepted: number;
  rates: {
    bounceRate: number;
    complaintRate: number;
    deliveredRate: number;
  };
  byKind: Record<EmailMessageKind, number>;
  series: Array<{ t: string; counts: Record<string, number> }>;
}

/**
 * One fan-out blast, aggregated (V2EmailMessagesDao.listBatches / getBatch).
 * `recipients` is every row in the blast including ones that never reached SES;
 * `accepted` is only those SES took and is the denominator for any rate.
 */
export interface EmailBatchSummary {
  batchId: string;
  subject: string | null;
  startedAt: string;
  recipients: number;
  accepted: number;
  counts: Record<EmailMessageStatus, number>;
}

/** One row from app_email_suppressions (AppEmailSuppressionsDao). */
export interface AppEmailSuppression {
  id: string;
  appId: string;
  email: string;
  source: SuppressionSource;
  createdAt: string;
}

/**
 * SES account-level suppression entry (SesIdentityService.getPlatformSuppression).
 * Non-null means this address stays blocked even after removing the app-level row —
 * the platform list is account-wide and is never cleared by the CLI.
 */
export interface PlatformSuppression {
  /** SES-reported reason, e.g. 'BOUNCE' or 'COMPLAINT'. */
  reason: string;
  at: string | null;
}

/** One row from the email inbox view (RequestLogDao.listInbox). */
export interface InboxEmailPreview {
  /** Also the request-log id; open detail with `requests get <id>`. */
  id: string;
  from: string;
  fromName: string | null;
  fromAddress: string;
  to: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  success: boolean;
  hasAttachments: boolean;
}

// ---------------------------------------------------------------------------
// Domain view shapes
// ---------------------------------------------------------------------------

/**
 * Minimum fields shared by both sending and inbound domain views.
 * Used by the `resolveDomainId` helper, which reads `id` and `domain` from
 * either list response.
 */
export interface EmailDomainBase {
  id: string;
  domain: string;
}

/** Visual verification status on the outbound-domains settings UI. */
export type OutboundEmailDomainUiStatus =
  'verified' | 'action_needed' | 'pending';

/** DNS records to create at the customer's DNS host for outbound sending. */
export interface OutboundDnsInstructions {
  /** Three DKIM CNAME records — all required for SES identity verification. */
  cnameRecords: Array<{ name: string; value: string }>;
  /** Recommended SPF TXT record; merge with an existing one if present. */
  recommendedSpf: { name: string; value: string };
}

/** Outbound (sending) domain view shape (outboundEmailDomains.ts toView). */
export interface OutboundEmailDomainView extends EmailDomainBase {
  verifiedAt: string | null;
  sesVerificationStatus: string | null;
  uiStatus: OutboundEmailDomainUiStatus;
  verificationErrors: unknown[] | null;
  createdAt: string;
  dnsInstructions: OutboundDnsInstructions;
}

/** Visual verification status on the inbound-domains settings UI. */
export type InboundEmailDomainUiStatus =
  'verified' | 'action_needed' | 'pending';

/** DNS record to create at the customer's DNS host for inbound mail routing. */
export interface InboundDnsInstructions {
  mxRecord: {
    name: string;
    priority: number;
    target: string;
  };
}

/** Inbound domain view shape (emailDomains.ts toView). */
export interface InboundEmailDomainView extends EmailDomainBase {
  verifiedAt: string | null;
  lastSyncedAt: string | null;
  verificationErrors: unknown[] | null;
  createdAt: string;
  uiStatus: InboundEmailDomainUiStatus;
  dnsInstructions: InboundDnsInstructions;
}

/**
 * Which rung of the sender fallback chain won. `app_domain` / `org_domain` /
 * `subdomain` / `default` are the no-`from` default-sender tiers; `custom_from`
 * is a caller-supplied handle on an owned domain; `sendgrid` is the v1 path.
 * (OutboundSenderTier in youai-api resolveOutboundFromAddress.ts.)
 */
export type EmailSenderTier =
  | 'app_domain'
  | 'org_domain'
  | 'subdomain'
  | 'default'
  | 'custom_from'
  | 'sendgrid';

/** Effective sender resolved from the fallback chain (outbound-email-domains list). */
export interface EmailEffectiveSender {
  address: string;
  tier: EmailSenderTier;
  /** Null for the `default` platform tier. */
  domain: string | null;
}

// ---------------------------------------------------------------------------
// Result types — one per endpoint/command
// ---------------------------------------------------------------------------

/** email list → GET /outbound-email/messages */
export interface EmailListResult {
  messages: V2EmailMessage[];
  nextCursor: string | null;
}

/** email get → GET /outbound-email/messages/:messageId */
export type EmailMessageResult = V2EmailMessage;

/** email stats → GET /outbound-email/summary */
export type EmailStatsResult = EmailSummary;

/** email batches → GET /outbound-email/batches */
export interface EmailBatchesResult {
  batches: EmailBatchSummary[];
  total: number;
}

/** email batch → GET /outbound-email/batches/:batchId */
export type EmailBatchResult = EmailBatchSummary;

/** email suppressions → GET /outbound-email/suppressions */
export interface EmailSuppressionsResult {
  suppressions: AppEmailSuppression[];
  nextCursor: string | null;
  total: number;
}

/** email suppress → POST /outbound-email/suppressions/add */
export interface EmailSuppressResult {
  ok: true;
}

/** email unsuppress → POST /outbound-email/suppressions/remove */
export interface EmailUnsuppressResult {
  ok: true;
  removed: boolean;
  platformSuppression: PlatformSuppression | null;
}

/** email inbox → GET /inbox */
export interface EmailInboxResult {
  emails: InboxEmailPreview[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Outbound (sending) domain result types
// ---------------------------------------------------------------------------

/** email domains list → GET /settings/outbound-email-domains */
export interface OutboundEmailDomainsListResult {
  domains: OutboundEmailDomainView[];
  effectiveSender: EmailEffectiveSender;
}

/** email domains check → POST /settings/outbound-email-domains/check-domain */
export interface OutboundEmailDomainCheckResult {
  valid: boolean;
  errorMessage?: string;
}

/** email domains add → POST /settings/outbound-email-domains */
export interface OutboundEmailDomainAddResult {
  domain: OutboundEmailDomainView;
}

/** email domains verify → POST /settings/outbound-email-domains/:id/retry */
export type OutboundEmailDomainVerifyResult = OutboundEmailDomainAddResult;

/** email domains remove → POST /settings/outbound-email-domains/:id/delete */
export interface OutboundEmailDomainDeleteResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// Inbound domain result types
// ---------------------------------------------------------------------------

/** email inbound-domains list → GET /settings/email-domains */
export interface InboundEmailDomainsListResult {
  domains: InboundEmailDomainView[];
}

/**
 * email inbound-domains check → POST /settings/email-domains/check-domain
 * `dnsInstructions` is included when `valid` is true — the MX record is known
 * without registering and can be given to the customer up front.
 */
export interface InboundEmailDomainCheckResult {
  valid: boolean;
  errorMessage?: string;
  dnsInstructions?: InboundDnsInstructions;
}

/** email inbound-domains add → POST /settings/email-domains */
export interface InboundEmailDomainAddResult {
  domain: InboundEmailDomainView;
}

/** email inbound-domains verify → POST /settings/email-domains/:id/retry */
export type InboundEmailDomainVerifyResult = InboundEmailDomainAddResult;

/** email inbound-domains remove → POST /settings/email-domains/:id/delete */
export interface InboundEmailDomainDeleteResult {
  ok: true;
}
