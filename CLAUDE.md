# remy-admin — conventions

The admin surface for production Remy apps, shipped two ways from one core: the `remy-admin` CLI (primary consumer: the Remy agent driving it via bash inside the sandbox) and the `@madewithremy/admin` import layer (`createAdminClient` / the lazy `admin` default). Extracted from mindstudio-sandbox's `src/cli/`.

## Architecture: ops core + two skins

- **`src/ops/<group>.ts`** — the core. Pure functions `(ctx: AdminContext, params) => Promise<TypedResult>`: no printing, no process.exit, no env reads, no fs. Failures throw `AdminApiError` / `AdminTimeoutError` (src/errors.ts) via `call`/`tryCall` in src/http.ts. Response types live in `src/types/<group>.ts`, hand-transcribed from the youai-api routes (source paths in each file's header) — never invent fields.
- **`src/commands/<group>.ts`** — the CLI skin: spec (flags/positionals/usage) + handlers that map `Args` onto ops and `out()` the result + the group help text. Everything process-shaped lives ONLY here: poll loops with exit codes, fs/stdin, `--confirm` gates, stderr advisories, the SSE/NDJSON streaming passthroughs (src/cliStream.ts).
- **`src/client.ts`** — the import layer: `bindOps` pre-applies the context to each ops module; namespaces mirror CLI groups 1:1. Generic ops (email's direction-conditional domain fns) are hand-bound there because the mapped type erases generics.
- **Adding a command = op + skin + nothing else** (the client picks the op up via its module). Registry: `src/commands/index.ts`; group list + top-level help: `src/routing.ts`.

## Contracts

- CLI stdout: exactly one JSON value per invocation (`out()`), compact when piped; progress to stderr (`progress()`); exit 0 / 10 (plus 1–4 for `releases wait`). Help is plain text, works with no env, discoverable at any depth via `--help`.
- The CLI's user-visible behavior is a compatibility surface for the agent's prompts — when refactoring, byte-identical output is the bar (capture help/error matrices before, diff after; see the phase-2 pass).
- Client: one client = one app (`appId` bound at construction; `forApp()` for a sibling). Errors are typed, results are typed, long composites take `onProgress`.
- Args parsing (src/args.ts) REJECTS unknown flags with the valid ones listed — silent flag-dropping is the worst failure mode for an agent operator.

## Op JSDoc convention (the docs source of truth)

Every exported op carries the documentation both the future docs site and llms.txt generate from — the CLI help text is the operational voice, but the semantics live here. Per op (see `src/ops/cron.ts` for the exemplar):

- A one-line summary (what it does, not how), plus remarks for semantics a caller can't guess: id relationships, clamps/defaults, async behavior ("returns 202; the run continues in the background").
- `@throws AdminApiError` naming the endpoint's real error strings with their statuses (`cron_job_not_found` (404) …) — the strings a caller will branch on.
- One `@example` using the bound client form (`admin.<group>.<fn>(...)` — no ctx argument), short and runnable.
- `@param` only where the name alone doesn't carry it; params-interface fields get their own JSDoc instead.
- `@internal` on anything exported only for the CLI skin (presentation helpers, timeout constants) — doc generators skip it; it still binds at runtime.

## Help-text style

Per-group help lists subcommands, then usage lines, then Notes (semantics an agent can't guess: error codes, id relationships like "a run's id is its request-log id", units, clamps), then Examples. Write for an operator who will paste error text back in — name the actual error strings.

## Don'ts

- No new runtime dependencies without strong cause (`json5` is the only one); the bin must stay a fast single file.
- No config commands or state — configuration is env + `mindstudio.json` only.
- No streaming in the import layer (CLI-only, deliberate) and no dashboard-only human flows (fork/transfer/delete, preview shares, attestation) — see `youai-api/.working-docs/api-first-app-management.md` for the surface map.
