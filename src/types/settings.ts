/**
 * Response types for the settings command group.
 *
 * Sources in youai-api:
 *   GET  /settings/v2   → src/http/routes/V2Apps/manage/settings.ts
 *   POST /settings/v2   → src/http/routes/V2Apps/manage/settings.ts
 *   V2AppSettings       → src/common/Db/AppsDao/_helpers/v2AppSettings.ts
 */

/**
 * Mutable app toggles stored in apps.v2_settings. Faithfully transcribed from
 * V2AppSettings in youai-api; this is the authoritative type for both the GET
 * and POST /settings/v2 responses.
 */
export interface V2AppSettings {
  /**
   * When true (default), reject signups via the email-OTP flow from known
   * disposable email domains. Checked at OTP send time, before the code is sent.
   */
  blockDisposableEmails?: boolean;

  /**
   * Master toggle for the signup allowlist. Default false. The list is only
   * enforced when this is true AND the list is non-empty.
   */
  signupAllowlistEnabled?: boolean;

  /**
   * Signup allowlist. When enforced, only emails matching an entry may register
   * via email-code. Entries: '*@domain.com' (whole domain) or 'user@domain.com'.
   * Case-insensitive; domain match is exact (no subdomains).
   */
  signupAllowlist?: string[];

  /**
   * Master toggle for test accounts (fixed-OTP login). Default false. When true,
   * identifiers in testAccounts sign in with their pre-set code instead of a
   * delivered one.
   */
  testAccountsEnabled?: boolean;

  /**
   * Test accounts for fixed-OTP login. Each entry has an email or E.164 phone
   * identifier and a fixed 6-digit numeric code. Capped at 5 entries.
   */
  testAccounts?: Array<{ identifier: string; code: string }>;

  /**
   * When true (default), frontend error reports may include response bodies for
   * failed fetch/xhr breadcrumbs (~1KB). Turn off if API responses may carry PII.
   */
  telemetryCaptureResponseBodies?: boolean;

  /**
   * Extra query-param names to preserve in analytics URLs beyond the platform
   * defaults (UTMs + ad click IDs).
   */
  analyticsExtraQueryParams?: string[];

  /**
   * Extra https origins allowed to iframe the deployed app, additive to the
   * platform baseline ('self' + launcher). Each entry is an exact https origin
   * (e.g. 'https://app.acme.com'). Capped at 25 entries.
   */
  additionalFrameAncestors?: string[];

  /**
   * When true, auto-run the read-only triage agent on new bug issues. Default false.
   */
  autoTriageIssues?: boolean;
}

/**
 * Response from GET /_internal/v2/apps/:appId/settings/v2 and
 * POST /_internal/v2/apps/:appId/settings/v2.
 * Both endpoints return the full current settings after any update.
 */
export interface SettingsResult {
  settings: V2AppSettings;
}
