/**
 * Response types for the secrets command group.
 *
 * Sources in youai-api:
 *   GET    /secrets         → src/http/routes/V2Apps/manage/secrets.ts
 *   GET    /secrets/:key    → src/http/routes/V2Apps/manage/secrets.ts
 *   PUT    /secrets/:key    → src/http/routes/V2Apps/manage/secrets.ts
 *   DELETE /secrets/:key    → src/http/routes/V2Apps/manage/secrets.ts
 *   AppSecretsDao           → src/common/Db/v2Apps/AppSecretsDao.ts
 */

/**
 * A secret metadata row (no decrypted values).
 * Returned by the list endpoint; mirrors AppSecret from AppSecretsDao.
 */
export interface AppSecretRow {
  id: string;
  appId: string;
  key: string;
  /** Whether a dev-environment value is currently stored. */
  hasDevValue: boolean;
  /** Whether a prod-environment value is currently stored. */
  hasProdValue: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response from GET /_internal/v2/apps/:appId/secrets. */
export interface SecretsListResult {
  secrets: AppSecretRow[];
}

/**
 * Response from GET /_internal/v2/apps/:appId/secrets/:key.
 * Returns KMS-decrypted values inline.
 */
export interface SecretsGetResult {
  key: string;
  devValue: string | null;
  prodValue: string | null;
}

/**
 * Response from PUT /_internal/v2/apps/:appId/secrets/:key.
 * Route returns HTTP 200 with { ok: true } (not a 204).
 */
export interface SecretsSetResult {
  ok: true;
}

/**
 * Response from DELETE /_internal/v2/apps/:appId/secrets/:key.
 * Route returns HTTP 200 with { ok: true } (not a 204).
 */
export interface SecretsDeleteResult {
  ok: true;
}
