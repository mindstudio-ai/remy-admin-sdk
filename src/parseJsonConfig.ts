/**
 * Pure parser for MindStudio-owned JSON config files. No I/O, no repair.
 *
 * App configs (`mindstudio.json`, interface configs like `web.json`) are
 * authored by remy, so they pick up the usual LLM-JSON slop — most often a
 * trailing comma left behind when an array entry is deleted.
 *
 * Strategy: strict JSON.parse first, JSON5 as a rescue. Strict-first means the
 * steady state is unaffected; the JSON5 path only engages for a file that would
 * otherwise have failed outright.
 *
 * Deliberately pure and read-only: this short-lived CLI must not mutate the
 * workspace out from under the running sandbox, whose own read path
 * (`jsonConfig.ts` in mindstudio-sandbox, where this module originated)
 * repairs the file on disk for the callers that DO write.
 */

import JSON5 from 'json5';

export type ParseResult<T> =
  | { ok: true; value: T; repaired: false }
  /** Strict parse failed; JSON5 rescued it. `error` is the strict failure. */
  | { ok: true; value: T; repaired: true; error: string }
  /** `notFound` separates "no such file" from "file exists but is broken" —
   *  callers log those very differently. */
  | { ok: false; error: string; notFound: boolean };

export function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse a config string. Pure — no I/O, no repair. Use this when the caller
 * already holds the file contents, or must not write (e.g. the CLI).
 */
export function parseJsonConfig<T>(raw: string): ParseResult<T> {
  let strictError: string;
  try {
    return { ok: true, value: JSON.parse(raw) as T, repaired: false };
  } catch (err) {
    strictError = msg(err);
  }

  try {
    return {
      ok: true,
      value: JSON5.parse(raw) as T,
      repaired: true,
      error: strictError,
    };
  } catch (err) {
    // Report the JSON5 error, not the strict one. JSON5 got further — it
    // tolerated the slop and failed on whatever is genuinely broken (a
    // truncated write, say), so its position is the actionable one. The
    // strict error would point at the first trailing comma and mislead.
    return { ok: false, error: msg(err), notFound: false };
  }
}
