/**
 * @madewithremy/admin — manage production Remy apps from code.
 *
 * Two ways in:
 *   import admin from '@madewithremy/admin';            // lazy, env-configured
 *   import { createAdminClient } from '@madewithremy/admin'; // explicit
 *
 * Every CLI command (`remy-admin <group> <sub>`) is a client method
 * (`admin.<group>.<sub>()`). Ops throw AdminApiError / AdminTimeoutError.
 */

export {
  createAdminClient,
  type AdminClient,
  type AdminClientOptions,
} from './client.js';
export type { AdminContext } from './ctx.js';
export { AdminApiError, AdminTimeoutError } from './errors.js';
export * from './types/index.js';

import { createAdminClient, type AdminClient } from './client.js';

// ---------------------------------------------------------------------------
// Lazy default singleton
// ---------------------------------------------------------------------------

/**
 * Lazy default client — created on first property access from the environment
 * (MINDSTUDIO_API_KEY, API_BASE_URL, the workspace's mindstudio.json), so the
 * import itself is safe anywhere; resolution errors surface at first use.
 *
 * ```ts
 * import admin from '@madewithremy/admin';
 * const { jobs } = await admin.cron.list({});
 * ```
 */
let _default: AdminClient;
export const admin: AdminClient = new Proxy({} as AdminClient, {
  get(_, prop, receiver) {
    _default ??= createAdminClient();
    const value = Reflect.get(_default, prop, _default);
    return typeof value === 'function' ? value.bind(_default) : value;
  },
});

export default admin;
