/**
 * App settings — the `apps.v2_settings` jsonb of dashboard-controlled toggles.
 *
 * One GET/POST route pair on the API side (`/settings/v2`); the POST accepts a
 * partial payload and the server validates + normalizes every security-shaped
 * value (allowlist globs, test-account identifiers/codes, frame-ancestor
 * origins), so mutators here send only the keys they change and surface the
 * route's error text as-is. List edits are read-modify-write: GET the current
 * settings, edit the one array, POST it back.
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as settingsOps from '../ops/settings.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';
import type { V2AppSettings } from '../types/settings.js';

/**
 * Keys writable via the generic `settings set`. The list-shaped security
 * settings (signupAllowlist, testAccounts, additionalFrameAncestors) are
 * deliberately absent — their add/remove subcommands avoid hand-assembled
 * arrays in argv and keep edits incremental.
 */
const SETTABLE_KEYS = [
  'blockDisposableEmails',
  'signupAllowlistEnabled',
  'testAccountsEnabled',
  'telemetryCaptureResponseBodies',
  'autoTriageIssues',
  'analyticsExtraQueryParams',
] as const;

export const settingsSpecs = {
  'settings get': {
    usage: 'Usage: remy-admin settings get',
  },
  'settings set': {
    usage: 'Usage: remy-admin settings set <key> <value>',
    positionals: [
      {
        name: 'key',
        required: true,
        choices: SETTABLE_KEYS,
        choiceLabel: 'Unknown settings key',
      },
      { name: 'value', required: true },
    ],
  },
  'settings allowlist list': {
    usage: 'Usage: remy-admin settings allowlist list',
  },
  'settings allowlist enable': {
    usage: 'Usage: remy-admin settings allowlist enable',
  },
  'settings allowlist disable': {
    usage: 'Usage: remy-admin settings allowlist disable',
  },
  'settings allowlist add': {
    usage: 'Usage: remy-admin settings allowlist add <entry>',
    positionals: [{ name: 'entry', required: true }],
  },
  'settings allowlist remove': {
    usage: 'Usage: remy-admin settings allowlist remove <entry>',
    positionals: [{ name: 'entry', required: true }],
  },
  'settings test-accounts list': {
    usage: 'Usage: remy-admin settings test-accounts list',
  },
  'settings test-accounts enable': {
    usage: 'Usage: remy-admin settings test-accounts enable',
  },
  'settings test-accounts disable': {
    usage: 'Usage: remy-admin settings test-accounts disable',
  },
  'settings test-accounts add': {
    usage: 'Usage: remy-admin settings test-accounts add <identifier> <code>',
    positionals: [
      { name: 'identifier', required: true },
      { name: 'code', required: true },
    ],
  },
  'settings test-accounts remove': {
    usage: 'Usage: remy-admin settings test-accounts remove <identifier>',
    positionals: [{ name: 'identifier', required: true }],
  },
  'settings frame-ancestors list': {
    usage: 'Usage: remy-admin settings frame-ancestors list',
  },
  'settings frame-ancestors add': {
    usage: 'Usage: remy-admin settings frame-ancestors add <origin>',
    positionals: [{ name: 'origin', required: true }],
  },
  'settings frame-ancestors remove': {
    usage: 'Usage: remy-admin settings frame-ancestors remove <origin>',
    positionals: [{ name: 'origin', required: true }],
  },
} satisfies Record<string, CommandSpec>;

/**
 * Match the server's identifier normalization (lowercase emails, strip phone
 * formatting) so a `remove` finds the stored form of whatever the user typed.
 */
function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes('@')
    ? trimmed.toLowerCase()
    : trimmed.replace(/[\s\-()]/g, '');
}

/** Coerce user input toward the stored `https://host` origin form for matching. */
function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\/+$/, '');
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
}

async function settingsGet(ctx: AdminContext) {
  out({ settings: await settingsOps.getSettings(ctx) });
}

async function settingsSet(ctx: AdminContext, a: Args) {
  const key = a.req('key');
  const raw = a.req('value');
  // JSON first so `true`, `false`, and `'["productId"]'` arrive typed; anything
  // that isn't JSON is a plain string. The route validates either way.
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  out({ settings: await settingsOps.updateSettings(ctx, { [key]: value }) });
}

//////////////////////////////////////////////////////////////////////////////
// Signup allowlist
//////////////////////////////////////////////////////////////////////////////

function allowlistView(s: V2AppSettings): {
  enabled: boolean;
  entries: string[];
  note?: string;
} {
  return {
    enabled: s.signupAllowlistEnabled === true,
    entries: s.signupAllowlist ?? [],
  };
}

async function allowlistList(ctx: AdminContext) {
  out(allowlistView(await settingsOps.getSettings(ctx)));
}

async function allowlistEnable(ctx: AdminContext) {
  const updated = await settingsOps.updateSettings(ctx, {
    signupAllowlistEnabled: true,
  });
  const view = allowlistView(updated);
  if (view.entries.length === 0) {
    view.note =
      'The allowlist is enabled but empty — an empty list allows everyone. Add entries to enforce it.';
  }
  out(view);
}

async function allowlistDisable(ctx: AdminContext) {
  out(
    allowlistView(
      await settingsOps.updateSettings(ctx, { signupAllowlistEnabled: false }),
    ),
  );
}

async function allowlistAdd(ctx: AdminContext, a: Args) {
  const entry = a.req('entry').trim().toLowerCase();
  const current = await settingsOps.getSettings(ctx);
  const entries: string[] = current.signupAllowlist ?? [];
  const next = entries.includes(entry) ? entries : [...entries, entry];
  const updated = await settingsOps.updateSettings(ctx, {
    signupAllowlist: next,
  });
  const view = allowlistView(updated);
  if (!view.enabled) {
    view.note =
      'signupAllowlistEnabled is off, so this list is not being enforced. Enable it with: remy-admin settings allowlist enable';
  }
  out(view);
}

async function allowlistRemove(ctx: AdminContext, a: Args) {
  const entry = a.req('entry').trim().toLowerCase();
  const current = await settingsOps.getSettings(ctx);
  const entries: string[] = current.signupAllowlist ?? [];
  if (!entries.includes(entry)) {
    fatal(`"${entry}" is not on the signup allowlist`);
  }
  const next = entries.filter((e) => e !== entry);
  const updated = await settingsOps.updateSettings(ctx, {
    signupAllowlist: next,
  });
  const view = allowlistView(updated);
  if (view.enabled && view.entries.length === 0) {
    view.note =
      'The allowlist is now empty while enabled — an empty list allows everyone.';
  }
  out(view);
}

//////////////////////////////////////////////////////////////////////////////
// Test accounts (fixed-OTP login)
//////////////////////////////////////////////////////////////////////////////

function testAccountsView(s: V2AppSettings): {
  enabled: boolean;
  accounts: Array<{ identifier: string; code: string }>;
  note?: string;
} {
  return {
    enabled: s.testAccountsEnabled === true,
    accounts: s.testAccounts ?? [],
  };
}

async function testAccountsList(ctx: AdminContext) {
  out(testAccountsView(await settingsOps.getSettings(ctx)));
}

async function testAccountsEnable(ctx: AdminContext) {
  out(
    testAccountsView(
      await settingsOps.updateSettings(ctx, { testAccountsEnabled: true }),
    ),
  );
}

async function testAccountsDisable(ctx: AdminContext) {
  out(
    testAccountsView(
      await settingsOps.updateSettings(ctx, { testAccountsEnabled: false }),
    ),
  );
}

async function testAccountsAdd(ctx: AdminContext, a: Args) {
  const identifier = normalizeIdentifier(a.req('identifier'));
  const code = a.req('code').trim();
  const current = await settingsOps.getSettings(ctx);
  const accounts: Array<{ identifier: string; code: string }> =
    current.testAccounts ?? [];
  const next = [
    ...accounts.filter((t) => t.identifier !== identifier),
    { identifier, code },
  ];
  const updated = await settingsOps.updateSettings(ctx, { testAccounts: next });
  const view = testAccountsView(updated);
  if (!view.enabled) {
    view.note =
      'testAccountsEnabled is off, so fixed-code login is not active. Enable it with: remy-admin settings test-accounts enable';
  }
  out(view);
}

async function testAccountsRemove(ctx: AdminContext, a: Args) {
  const identifier = normalizeIdentifier(a.req('identifier'));
  const current = await settingsOps.getSettings(ctx);
  const accounts: Array<{ identifier: string; code: string }> =
    current.testAccounts ?? [];
  if (!accounts.some((t) => t.identifier === identifier)) {
    fatal(`"${identifier}" is not a configured test account`);
  }
  const next = accounts.filter((t) => t.identifier !== identifier);
  out(
    testAccountsView(
      await settingsOps.updateSettings(ctx, { testAccounts: next }),
    ),
  );
}

//////////////////////////////////////////////////////////////////////////////
// Frame ancestors (embedding allow-list)
//////////////////////////////////////////////////////////////////////////////

async function frameAncestorsList(ctx: AdminContext) {
  const s = await settingsOps.getSettings(ctx);
  out({ origins: s.additionalFrameAncestors ?? [] });
}

async function frameAncestorsAdd(ctx: AdminContext, a: Args) {
  const origin = normalizeOrigin(a.req('origin'));
  const current = await settingsOps.getSettings(ctx);
  const origins: string[] = current.additionalFrameAncestors ?? [];
  const next = origins.includes(origin) ? origins : [...origins, origin];
  const updated = await settingsOps.updateSettings(ctx, {
    additionalFrameAncestors: next,
  });
  out({ origins: updated.additionalFrameAncestors ?? [] });
}

async function frameAncestorsRemove(ctx: AdminContext, a: Args) {
  const origin = normalizeOrigin(a.req('origin'));
  const current = await settingsOps.getSettings(ctx);
  const origins: string[] = current.additionalFrameAncestors ?? [];
  if (!origins.includes(origin)) {
    fatal(`"${origin}" is not on the frame-ancestors list`);
  }
  const next = origins.filter((o) => o !== origin);
  const updated = await settingsOps.updateSettings(ctx, {
    additionalFrameAncestors: next,
  });
  out({ origins: updated.additionalFrameAncestors ?? [] });
}

export const settingsHandlers = {
  'settings get': settingsGet,
  'settings set': settingsSet,
  'settings allowlist list': allowlistList,
  'settings allowlist enable': allowlistEnable,
  'settings allowlist disable': allowlistDisable,
  'settings allowlist add': allowlistAdd,
  'settings allowlist remove': allowlistRemove,
  'settings test-accounts list': testAccountsList,
  'settings test-accounts enable': testAccountsEnable,
  'settings test-accounts disable': testAccountsDisable,
  'settings test-accounts add': testAccountsAdd,
  'settings test-accounts remove': testAccountsRemove,
  'settings frame-ancestors list': frameAncestorsList,
  'settings frame-ancestors add': frameAncestorsAdd,
  'settings frame-ancestors remove': frameAncestorsRemove,
} satisfies Record<keyof typeof settingsSpecs, Handler>;

export const settingsHelp = `remy-admin settings — App settings (platform-enforced toggles, not app code).

Subcommands:
  get                          Dump all settings
  set <key> <value>            Set a scalar setting (value parsed as JSON, else string)

  allowlist list               Show the signup allowlist + whether it's enforced
  allowlist enable|disable     Toggle enforcement (signupAllowlistEnabled)
  allowlist add <entry>        Add "*@domain.com" (whole domain) or "user@domain.com"
  allowlist remove <entry>     Remove an entry

  test-accounts list           Show fixed-code test accounts + whether they're active
  test-accounts enable|disable Toggle fixed-code login (testAccountsEnabled)
  test-accounts add <id> <code>   Add an email or E.164 phone with a fixed 6-digit code
  test-accounts remove <id>    Remove a test account

  frame-ancestors list         Show extra origins allowed to iframe the deployed app
  frame-ancestors add <origin>    Allow an exact https origin (e.g. https://app.acme.com)
  frame-ancestors remove <origin> Remove an origin

Settable keys (settings set):
  blockDisposableEmails          Reject email-code signups from disposable/burner
                                 domains, checked before the code is sent. Default: true.
  signupAllowlistEnabled         Enforce the signup allowlist. Default: false. Prefer
                                 'allowlist enable'.
  testAccountsEnabled            Activate fixed-code test accounts. Default: false.
                                 Prefer 'test-accounts enable'.
  telemetryCaptureResponseBodies Include failed-request response bodies (~1KB) in
                                 frontend error reports. Default: true; turn off if API
                                 responses may carry PII or tokens.
  autoTriageIssues               Auto-run the read-only triage agent on new bug issues.
                                 Default: false.
  analyticsExtraQueryParams      JSON array of query-param names to preserve in
                                 analytics URLs beyond the UTM/ad-click defaults.

Usage:
  remy-admin settings get
  remy-admin settings allowlist add '*@acme.com'
  remy-admin settings allowlist enable
  remy-admin settings test-accounts add reviewer@example.com 123456
  remy-admin settings test-accounts enable
  remy-admin settings frame-ancestors add https://app.acme.com
  remy-admin settings set blockDisposableEmails false
  remy-admin settings set analyticsExtraQueryParams '["productId","step"]'

Notes:
  - The signup allowlist applies to email-code login only — not sms-code,
    api-key, or delegated "Sign in with Remy". Entries are exact: '*@acme.com'
    does not match subdomains (add '*@sub.acme.com' separately).
  - An enabled-but-empty allowlist allows everyone — never a lockout. Blocked
    signups fail at code-send time with error code 'email_not_allowed'.
  - The dev-session test login (remy@mindstudio.ai) bypasses the allowlist, so
    auth can still be smoke-tested in the editor preview after enabling it.
  - Test accounts (max 5) skip real code delivery and bypass the disposable +
    allowlist gates — built for handing app-store reviewers working
    credentials. They work in production; disable after review.
  - frame-ancestors is additive to the platform baseline ('self' + launcher);
    it applies to the deployed app, not the IDE preview. Max 25 origins.`;
