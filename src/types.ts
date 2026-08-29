/**
 * Shared shape of a CLI command implementation, used by the registry in
 * commands/index.ts.
 */

import type { Args } from './args.js';
import type { AdminContext } from './ctx.js';

/**
 * A command implementation: a thin skin that maps parsed Args onto an op in
 * src/ops/ and prints the result. The registry in `commands/index.ts` holds
 * one per spec key.
 *
 * Handlers that need no arguments declare `(ctx: AdminContext)` and remain
 * assignable here by structural typing — no need to accept an unused parameter.
 */
export type Handler = (ctx: AdminContext, a: Args) => Promise<void>;
