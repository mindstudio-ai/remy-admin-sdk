/**
 * CLI skin for the `methods` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/methods.js (pure, typed); response
 * shapes in ../types/methods.js.
 *
 * CLI skin retains: the --stream SSE passthrough to stdout (cliStream).
 */

import { type Args, type CommandSpec } from '../args.js';
import { streamToStdout } from '../cliStream.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import { seg } from '../http.js';
import * as methods from '../ops/methods.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const methodsSpecs = {
  'methods list': {
    usage: 'Usage: remy-admin methods list',
  },
  'methods invoke': {
    usage:
      'Usage: remy-admin methods invoke <methodId> [--input \'{"key":"value"}\'] [--stream] [--roles <a,b,c>] [--user-id <userId>]',
    positionals: [{ name: 'methodId', required: true }],
    flags: {
      input: { type: 'string' },
      stream: { type: 'boolean' },
      roles: { type: 'string' },
      'user-id': { type: 'string' },
    },
  },
} satisfies Record<string, CommandSpec>;

async function methodsList(ctx: AdminContext) {
  out(await methods.list(ctx));
}
async function methodsInvoke(ctx: AdminContext, a: Args) {
  const methodId = a.req('methodId');

  const inputRaw = a.str('input');
  let input: Record<string, any> = {};
  if (inputRaw) {
    try {
      input = JSON.parse(inputRaw);
    } catch {
      fatal(`Invalid JSON for --input: ${inputRaw}`);
    }
  }

  // Optional impersonation. If either flag is set we hit /invoke-as instead
  // of /invoke so the method runs with the supplied roles / user identity
  // (lets the CLI test role-gated methods without spec edits).
  const rolesRaw = a.str('roles');
  const userId = a.str('user-id');
  const impersonate: { roles?: string[]; userId?: string } = {};
  if (rolesRaw) {
    impersonate.roles = rolesRaw
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  }
  if (userId) {
    impersonate.userId = userId;
  }
  const useImpersonate =
    impersonate.roles !== undefined || impersonate.userId !== undefined;

  const stream = a.bool('stream');
  const apiPath = useImpersonate
    ? `/_internal/v2/apps/${ctx.appId}/methods/${seg(methodId)}/invoke-as`
    : `/_internal/v2/apps/${ctx.appId}/methods/${seg(methodId)}/invoke`;
  const body: Record<string, unknown> = useImpersonate
    ? { input, impersonate }
    : { input };

  if (stream) {
    await streamToStdout(ctx, apiPath, { ...body, stream: true });
  } else {
    out(
      await methods.invoke(ctx, {
        methodId,
        input,
        impersonate: useImpersonate ? impersonate : undefined,
      }),
    );
  }
}

export const methodsHandlers = {
  'methods list': methodsList,
  'methods invoke': methodsInvoke,
} satisfies Record<keyof typeof methodsSpecs, Handler>;

export const methodsHelp = `remy-admin methods — List and invoke methods.

Subcommands:
  list     List methods available in the live release
  invoke   Invoke a method with optional input

Usage:
  remy-admin methods list
  remy-admin methods invoke <methodId> [options]

Options for invoke:
  --input '<json>'       Method input (JSON object)
  --stream               Stream the response as SSE events
  --roles <a,b,c>        Run with these roles (comma-separated). Routes the
                         call through /invoke-as so role-gated methods can
                         be tested without spec edits.
  --user-id <userId>     Run as this user. Combine with --roles to set
                         identity AND role list explicitly. Either flag
                         alone also works.

Examples:
  remy-admin methods list
  remy-admin methods invoke mth_abc123
  remy-admin methods invoke mth_abc123 --input '{"query":"hello"}'
  remy-admin methods invoke mth_abc123 --input '{"query":"hello"}' --stream
  remy-admin methods invoke mth_abc123 --roles admin
  remy-admin methods invoke mth_abc123 --user-id user_abc --roles analyst,admin`;
