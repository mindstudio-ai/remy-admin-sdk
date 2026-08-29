/**
 * Database query operations.
 *
 * Ops are pure (ctx, sql) → typed result; the CLI skin in commands/db.ts
 * owns SQL assembly (the raw-spec mode, the tables introspection query) and
 * all output.
 */

import type { AdminContext } from '../ctx.js';
import { call } from '../http.js';
import type { DbQueryResult } from '../types/db.js';

/**
 * Execute one SQL statement against the app's live-release database.
 *
 * The statement is passed verbatim — no parsing or rewriting. Both read
 * (`SELECT`) and write (`INSERT`, `UPDATE`, `DELETE`) statements are
 * accepted. The `results` array always has exactly one element for a single
 * statement; `changes` is 0 for SELECT.
 *
 * SQL errors (syntax, constraint violations, etc.) surface as HTTP 400
 * responses with a `code` field rather than throwing — check `error.code`
 * in the response when the call fails.
 *
 * @param sql The SQL statement to execute.
 * @throws AdminApiError `no_live_release` (404) — the app has not been
 *   deployed; `no_database` (404) — the live release has no database;
 *   `invalid_request` (400) — `queries[]` missing or malformed;
 *   `query_error` (400) — the SQL failed at the database layer;
 *   `unique_constraint_violated` (400) — a UNIQUE constraint was violated.
 * @example
 * const { results } = await admin.db.query('SELECT * FROM users LIMIT 10');
 */
export function query(ctx: AdminContext, sql: string) {
  return call<DbQueryResult>(
    ctx,
    'POST',
    `/_internal/v2/apps/${ctx.appId}/db/query`,
    { queries: [{ sql }] },
  );
}
