/**
 * CLI skin for the `secrets` group: command specs, Args-to-params mapping,
 * and help text. Operations live in ../ops/secrets.js (pure, typed); response
 * shapes in ../types/secrets.js.
 *
 * CLI skin retains: the set-body construction (the --dev-clear → null
 * distinction).
 */

import { type Args, type CommandSpec } from '../args.js';
import type { AdminContext } from '../ctx.js';
import { fatal } from '../errors.js';
import * as secrets from '../ops/secrets.js';
import { out } from '../output.js';
import type { Handler } from '../types.js';

export const secretsSpecs = {
  'secrets list': {
    usage: 'Usage: remy-admin secrets list',
  },
  'secrets get': {
    usage: 'Usage: remy-admin secrets get <KEY>',
    positionals: [{ name: 'key', required: true }],
  },
  'secrets set': {
    usage:
      'Usage: remy-admin secrets set <KEY> [--dev <value>] [--prod <value>] [--dev-clear] [--prod-clear]',
    positionals: [{ name: 'key', required: true }],
    flags: {
      dev: { type: 'string' },
      prod: { type: 'string' },
      'dev-clear': { type: 'boolean' },
      'prod-clear': { type: 'boolean' },
    },
    requireAnyOf: {
      flags: ['dev', 'prod', 'dev-clear', 'prod-clear'],
      message:
        'At least one of --dev <value>, --prod <value>, --dev-clear, or --prod-clear is required',
    },
  },
  'secrets delete': {
    usage: 'Usage: remy-admin secrets delete <KEY>',
    positionals: [{ name: 'key', required: true }],
  },
} satisfies Record<string, CommandSpec>;

async function secretsList(ctx: AdminContext) {
  out(await secrets.list(ctx));
}
async function secretsGet(ctx: AdminContext, a: Args) {
  out(await secrets.get(ctx, a.req('key')));
}
async function secretsSet(ctx: AdminContext, a: Args) {
  const key = a.req('key');

  const dev = a.str('dev');
  const prod = a.str('prod');
  const devClear = a.bool('dev-clear');
  const prodClear = a.bool('prod-clear');

  const params: secrets.SecretsSetParams = {};

  if (dev !== undefined) {
    params.devValue = dev;
  } else if (devClear) {
    params.devValue = null;
  }

  if (prod !== undefined) {
    params.prodValue = prod;
  } else if (prodClear) {
    params.prodValue = null;
  }

  if (!('devValue' in params) && !('prodValue' in params)) {
    fatal(
      'At least one of --dev <value>, --prod <value>, --dev-clear, or --prod-clear is required',
    );
  }

  out(await secrets.set(ctx, key, params));
}
async function secretsDelete(ctx: AdminContext, a: Args) {
  out(await secrets.del(ctx, a.req('key')));
}

export const secretsHandlers = {
  'secrets list': secretsList,
  'secrets get': secretsGet,
  'secrets set': secretsSet,
  'secrets delete': secretsDelete,
} satisfies Record<keyof typeof secretsSpecs, Handler>;

export const secretsHelp = `remy-admin secrets — Manage app secrets (environment variables).

Subcommands:
  list     List all secret keys (values are not shown, only which environments have values)
  get      Get decrypted values for a secret
  set      Create or update a secret's value for dev and/or prod
  delete   Delete a secret entirely (both dev and prod values)

Usage:
  remy-admin secrets list
  remy-admin secrets get <KEY>
  remy-admin secrets set <KEY> [--dev <value>] [--prod <value>] [--dev-clear] [--prod-clear]
  remy-admin secrets delete <KEY>

The set command updates only the environments you specify:
  --dev <value>    Set the dev environment value
  --prod <value>   Set the prod environment value
  --dev-clear      Clear the dev environment value
  --prod-clear     Clear the prod environment value
  Omitted fields are left unchanged.

Examples:
  remy-admin secrets list
  remy-admin secrets get STRIPE_SECRET_KEY
  remy-admin secrets set STRIPE_SECRET_KEY --dev sk_test_abc --prod sk_live_xyz
  remy-admin secrets set OPENAI_API_KEY --prod sk-abc123
  remy-admin secrets set OLD_KEY --prod-clear
  remy-admin secrets delete OLD_KEY

Notes:
  - If a value starts with a dash, use the '=' form so it isn't read as a flag:
    remy-admin secrets set KEY --prod=-abc123`;
