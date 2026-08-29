/**
 * Response types for the v2 custom domains and subdomain endpoints.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/settings.ts        — custom-subdomain routes
 *   src/http/routes/V2Apps/manage/customDomains.ts   — custom-domains routes
 *   (local HostnameView + DnsInstructions interfaces in customDomains.ts)
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Lifecycle status shown in dashboards and the CLI.
 * Derived by `deriveUiStatus` from the Cloudflare cfStatus / cfSslStatus pair.
 */
export type DomainsCustomHostnameUiStatus =
  'waiting_for_dns' | 'issuing_ssl' | 'live' | 'action_needed' | 'reconnecting';

/** DNS records the customer must add for a custom hostname. */
export interface DomainsDnsInstructions {
  kind: 'cname' | 'a_records';
  /** Present when kind is 'cname'. */
  cname?: { name: string; target: string };
  /** Present when kind is 'a_records'. */
  aRecords?: {
    v4: Array<{ name: string; value: string }>;
    v6: Array<{ name: string; value: string }>;
  };
}

/**
 * One custom hostname entry as returned by the custom-domains list, add, and
 * retry endpoints. `dnsInstructions` is computed server-side from the row.
 */
export interface DomainsCustomHostnameView {
  id: string;
  hostname: string;
  isApex: boolean;
  pairRole: string | null;
  pairedHostnameId: string | null;
  cfStatus: string | null;
  cfSslStatus: string | null;
  uiStatus: DomainsCustomHostnameUiStatus;
  dcvMethod: string;
  ownershipVerification: Record<string, unknown> | null;
  validationRecords: Record<string, unknown>[] | null;
  verificationErrors: unknown[] | null;
  activatedAt: string | null;
  movedAt: string | null;
  createdAt: string;
  dnsInstructions: DomainsDnsInstructions;
}

// ---------------------------------------------------------------------------
// Endpoint responses
// ---------------------------------------------------------------------------

/** GET /_internal/v2/apps/:appId/settings/custom-subdomain */
export interface DomainsGetResult {
  /** Public (hyphenated) subdomain, or null if unset. */
  subdomain: string | null;
}

/** POST /_internal/v2/apps/:appId/settings/custom-subdomain */
export interface DomainsSetResult {
  subdomain: string | null;
}

/** POST /_internal/v2/apps/:appId/settings/custom-subdomain/check-availability */
export interface DomainsCheckResult {
  /** Normalized (public hyphenated) form of the requested subdomain. */
  subdomain: string;
  isAvailable: boolean;
}

/** GET /_internal/v2/apps/:appId/settings/custom-domains */
export interface DomainsCustomListResult {
  hostnames: DomainsCustomHostnameView[];
}

/**
 * POST /_internal/v2/apps/:appId/settings/custom-domains — register a hostname.
 * Apex input auto-creates the www. pair; both are returned in that case.
 */
export interface DomainsCustomAddResult {
  hostnames: DomainsCustomHostnameView[];
}

/** POST /_internal/v2/apps/:appId/settings/custom-domains/check-domain */
export interface DomainsCustomCheckResult {
  valid: boolean;
  isApex: boolean;
  /** True when an apex input will auto-create the www. pair on add. */
  willAutoPairWww: boolean;
  /** Human-readable reason; present when valid is false. */
  errorMessage?: string;
}

/** POST /_internal/v2/apps/:appId/settings/custom-domains/:id/delete */
export interface DomainsCustomRemoveResult {
  ok: true;
}

/** POST /_internal/v2/apps/:appId/settings/custom-domains/:id/retry */
export interface DomainsCustomRetryResult {
  hostname: DomainsCustomHostnameView;
}
