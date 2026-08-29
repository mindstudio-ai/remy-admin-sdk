/**
 * CLI skin for the `db` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/db.js (pure, typed); response
 * shapes in ../types/db.js.
 *
 * CLI skin retains: raw-SQL argument assembly (the spec is `raw: true` so SQL
 * beginning with `--` isn't rejected as an unknown flag).
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as db from '../ops/db.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const dbSpecs = {
  'db query': {
    // raw: SQL may legally begin with a `--` comment, which strict flag parsing
    // would reject as an unknown option. This command takes no flags at all.
    usage: 'Usage: remy-admin db query <sql>',
    raw: true,
    positionals: [{ name: 'sql', required: true }],
  },
  'db tables': {
    usage: 'Usage: remy-admin db tables',
  },
} satisfies Record<string, CommandSpec>;

async function dbQuery(ctx: AdminContext, a: Args) {
  out(await db.query(ctx, a.req('sql')));
}

async function dbTables(ctx: AdminContext) {
  out(
    await db.query(
      ctx,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ),
  );
}

export const dbHandlers = {
  'db query': dbQuery,
  'db tables': dbTables,
} satisfies Record<keyof typeof dbSpecs, Handler>;

export const dbHelp = `remy-admin db — Query the production database.

Subcommands:
  query    Execute a SQL query against the live release's database
  tables   List all tables in the database

Usage:
  remy-admin db <sql>
  remy-admin db query <sql>
  remy-admin db tables

Examples:
  remy-admin db tables
  remy-admin db "SELECT * FROM users LIMIT 10"
  remy-admin db "INSERT INTO categories (name) VALUES ('Electronics')"
  remy-admin db query "SELECT * FROM users LIMIT 10"

Notes:
  - SQL is taken verbatim: this is the one command that does not parse flags, so
    a statement may safely begin with a '--' comment. Always quote the SQL.`;
