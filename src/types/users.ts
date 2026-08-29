/**
 * Response types for the v2 app users endpoints.
 *
 * Transcribed from youai-api:
 *   src/http/routes/V2Apps/manage/appUsers.ts        — per-endpoint responses
 *   src/common/Db/v2Apps/V2AppManagedUsersDao.ts     — V2AppManagedUser shape
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * How a managed user authenticates, derived server-side from the user row's
 * `provider` + contact fields. Open enum: known values are 'email' | 'phone'
 * | 'remy' | 'unknown'; new provider values may arrive as the platform grows.
 */
export type UserAuthProvider =
  'email' | 'phone' | 'remy' | 'unknown' | (string & {});

/** One app-managed user as returned by the list endpoint. */
export interface UserListItem {
  id: string;
  email: string | null;
  phone: string | null;
  /** Derived auth method. */
  authProvider: UserAuthProvider;
  roles: string[];
  /** Masked API key for display (e.g. `ms_abcd...xyz`); null if none generated. */
  apiKeyMasked: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Full managed-user row minus the `apiKeyHash` secret, returned after a role
 * update. Matches `Omit<V2AppManagedUser, 'apiKeyHash'>` from the DAO.
 */
export interface UserRecord {
  id: string;
  appId: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  /** Raw provider field; null for code-verified (email-code / sms-code) rows. */
  provider: string | null;
  apiKeyMasked: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

// ---------------------------------------------------------------------------
// Endpoint responses
// ---------------------------------------------------------------------------

/** GET /_internal/v2/apps/:appId/users */
export interface UsersListResult {
  users: UserListItem[];
}

/** POST /_internal/v2/apps/:appId/users/:userId/roles */
export interface UsersSetRoleResult {
  user: UserRecord | null;
}

/** POST /_internal/v2/apps/:appId/users/:userId/api-key — full key returned once. */
export interface UsersCreateApiKeyResult {
  /** The full plaintext API key — only returned at creation time, never again. */
  key: string;
  /** The masked form stored for display (e.g. `ms_abcd...xyz`). */
  apiKey: string;
}

/** DELETE /_internal/v2/apps/:appId/users/:userId/api-key */
export interface UsersRevokeApiKeyResult {
  success: true;
}
