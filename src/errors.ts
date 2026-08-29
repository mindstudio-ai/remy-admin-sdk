/**
 * Error + exit-code vocabulary for the remy-admin CLI.
 *
 * Exit codes are a contract remy can branch on without parsing stdout. The
 * 0-4 range belongs to `releases wait` (see HELP_RELEASES) and predates this
 * module; `generic` is deliberately 10 so that a bad API key or an unparseable
 * mindstudio.json can never be mistaken for exit 1 = "build failed".
 */

export const EXIT = {
  /** live (or preview, for a feature branch) */
  ok: 0,
  /** `releases wait` only: the build failed */
  buildFailed: 1,
  /** `releases wait` only: still building when --timeout elapsed */
  timeout: 2,
  /** `releases wait` only: no release ever appeared for the commit */
  notFound: 3,
  /** `releases wait` only: built, but a newer release replaced it */
  superseded: 4,
  /** Any other failure: bad arguments, missing config, API error, timeout. */
  generic: 10,
} as const;

/**
 * A failure that should be reported as `{"error": ...}` on stdout.
 *
 * Thrown rather than exiting so that main()'s catch can print the message and
 * set `process.exitCode`, letting node flush stdout naturally. Calling
 * process.exit() here would truncate the message at one pipe buffer (64 KiB) —
 * which is exactly how remy invokes this CLI.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number = EXIT.generic,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * A failure caused by bad input. Carries the command's verbatim usage string
 * so the caller sees exactly what it should have typed.
 */
export class UsageError extends CliError {
  constructor(detail: string | null, usage: string) {
    super([detail, usage].filter(Boolean).join('\n'));
    this.name = 'UsageError';
  }
}

/**
 * Report a failure and stop.
 *
 * Throws rather than calling process.exit(): exit() does not drain an async
 * stdout write, so a message larger than one pipe buffer (64 KiB) was truncated
 * mid-JSON — and a pipe is exactly how remy invokes this CLI. The entry point's
 * catch prints and sets process.exitCode, letting node flush on its own. Typed
 * `never`, so callers use it as a terminator.
 */
export function fatal(message: string): never {
  throw new CliError(message);
}

/**
 * A non-2xx API response, thrown by the ops core (src/http.ts) so both skins
 * share one error surface: the CLI's entry-point catch prints `.message`
 * (built to the CLI's historical string) and exits 10; an importing caller
 * gets the structured fields.
 */
export class AdminApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${method} ${path} returned ${status}: ${JSON.stringify(body)}`);
    this.name = 'AdminApiError';
  }
}

/** A request that exceeded its time bound before a response arrived. */
export class AdminTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs / 1000}s`);
    this.name = 'AdminTimeoutError';
  }
}
