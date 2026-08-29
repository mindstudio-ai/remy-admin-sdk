/**
 * CLI skin for the `users` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/users.js (pure, typed); response
 * shapes in ../types/users.js.
 *
 * Pure thin skin — every handler maps flags onto an op and prints the result.
 */

import { PAGINATION, type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import * as users from '../ops/users.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const usersSpecs = {
  'users list': {
    usage: 'Usage: remy-admin users list [--limit 50] [--offset 0]',
    flags: { ...PAGINATION },
  },
  'users set-role': {
    usage: 'Usage: remy-admin users set-role <userId> <role>',
    positionals: [
      { name: 'userId', required: true },
      { name: 'role', required: true },
    ],
  },
  'users create-api-key': {
    usage: 'Usage: remy-admin users create-api-key <userId>',
    positionals: [{ name: 'userId', required: true }],
  },
  'users revoke-api-key': {
    usage: 'Usage: remy-admin users revoke-api-key <userId>',
    positionals: [{ name: 'userId', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function usersList(ctx: AdminContext, a: Args) {
  out(
    await users.list(ctx, {
      limit: a.num('limit'),
      offset: a.num('offset'),
    }),
  );
}
async function usersSetRole(ctx: AdminContext, a: Args) {
  out(await users.setRole(ctx, a.req('userId'), a.req('role')));
}
async function usersCreateApiKey(ctx: AdminContext, a: Args) {
  out(await users.createApiKey(ctx, a.req('userId')));
}
async function usersRevokeApiKey(ctx: AdminContext, a: Args) {
  out(await users.revokeApiKey(ctx, a.req('userId')));
}

export const usersHandlers = {
  'users list': usersList,
  'users set-role': usersSetRole,
  'users create-api-key': usersCreateApiKey,
  'users revoke-api-key': usersRevokeApiKey,
} satisfies Record<keyof typeof usersSpecs, Handler>;

export const usersHelp = `remy-admin users — Manage app users, roles, and API keys.

Subcommands:
  list              List app users (includes apiKeyMasked per user)
  set-role          Set a user's role
  create-api-key    Generate an API key for a user (returns full key once)
  revoke-api-key    Revoke a user's API key (immediate, in-flight requests will fail)

Usage:
  remy-admin users list [--limit 50] [--offset 0]
  remy-admin users set-role <userId> <role>
  remy-admin users create-api-key <userId>
  remy-admin users revoke-api-key <userId>

Examples:
  remy-admin users list --limit 20
  remy-admin users set-role usr_abc123 admin
  remy-admin users create-api-key usr_abc123
  remy-admin users revoke-api-key usr_abc123`;
