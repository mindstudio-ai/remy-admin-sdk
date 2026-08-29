/**
 * Response types for the db command group.
 *
 * Sources in youai-api:
 *   POST /db/query   → src/http/routes/V2Apps/manage/dbQuery.ts
 *                      AppDataDatabasesDao.executeSqlBatch returns
 *                      Array<{ rows: any[]; changes: number }>
 */

/**
 * Response from POST /_internal/v2/apps/:appId/db/query.
 * Used by both 'db query' and 'db tables'. Row values are database-specific
 * and typed unknown; changes is the SQLite rowcount for DML statements.
 */
export interface DbQueryResult {
  results: Array<{
    /** Result rows from the query. Values are dynamic; typed unknown. */
    rows: unknown[];
    /** Rows modified by a DML statement; 0 for SELECT. */
    changes: number;
  }>;
}
