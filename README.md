# @madewithremy/admin

Admin SDK + CLI for managing production Remy apps: request logs, analytics, releases, users, secrets, database, files, email (including custom sending/receiving domains), scheduled jobs, and more. Every operation wraps the same management API the dashboard uses, so anything answerable in the console is answerable here — from the terminal or from code.

One surface, two skins: every CLI command (`remy-admin <group> <sub>`) is also a typed client method (`admin.<group>.<sub>()`). Both are thin layers over the same ops core.

## Install

```bash
npm install -g @madewithremy/admin    # CLI on PATH
npm install @madewithremy/admin      # import layer in a project
```

## CLI

```bash
remy-admin --help              # all command groups
remy-admin <group> --help      # per-group commands, flags, examples
```

All output is JSON (one value, compact when piped, pretty on a TTY). Unknown flags are rejected rather than ignored. Exit codes: 0 success, 10 any error (`releases wait` additionally uses 1–4 for build outcomes).

Configuration is read from the environment and the workspace — there are no config commands:

| Source | Meaning |
|---|---|
| `MINDSTUDIO_API_KEY` | Org-scoped `sk_` API key (required) |
| `API_BASE_URL` | API origin (default `https://api.mindstudio.ai`) |
| `WORKSPACE_DIR` | Workspace root (default `/home/vercel-sandbox/workspace`) |
| `${WORKSPACE_DIR}/mindstudio.json` | `appId` — which app the CLI manages |

## Import layer

```ts
// Lazy, environment-configured (same resolution as the CLI):
import admin from '@madewithremy/admin';
const { jobs } = await admin.cron.list({});

// Explicit — one client is bound to one app:
import { createAdminClient, AdminApiError } from '@madewithremy/admin';
const client = createAdminClient({ apiKey: 'sk_…', appId: 'app_…' });

const { releases } = await client.releases.list({ limit: 5 });
const { url } = await client.files.put({
  content: buffer,
  store: 'assets',
  access: 'public',
  filename: 'hero.jpg',
});
const domains = await client.email.listDomains('sending'); // typed per direction
const other = client.forApp('app_other');                  // sibling client, same credentials

try {
  await client.requests.get('req_missing');
} catch (err) {
  if (err instanceof AdminApiError) console.log(err.status, err.body);
}
```

Every response is fully typed (the shapes are hand-transcribed from the platform API). Failures throw `AdminApiError` (method/path/status/body) or `AdminTimeoutError`. Long-running composites take an `onProgress` callback (`releases.waitForCommit`, `dataSources.addDocument` / `waitForIngest`, `files.put`). The SSE/NDJSON streaming paths (`methods invoke --stream`, `jewels export --file`) are CLI-only.

## Development

```bash
npm install
npm run typecheck
npm run build        # tsup → dist/index.js (+ d.ts) and dist/prod.js (bin)
node dist/prod.js --help
```

Layout: `src/ops/` is the pure core (one module per group: `(ctx, params) → typed result`, no printing/exiting), `src/commands/` the CLI skins (spec + Args→params + output), `src/client.ts` the import layer binding a context over the ops, `src/types/` the response types. See `CLAUDE.md` for the conventions.
