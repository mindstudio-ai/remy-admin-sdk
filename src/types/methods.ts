/**
 * Response types for the methods command group.
 *
 * 'methods list' uses DashboardResult from ./releases.ts (both commands call
 * GET /dashboard and read liveRelease).
 *
 * Sources in youai-api:
 *   POST /methods/:methodId/invoke
 *     → src/http/routes/V2Apps/serve/methods/handleInvoke.ts
 *   POST /methods/:methodId/invoke-as
 *     → src/http/routes/V2Apps/manage/invokeMethodAs.ts
 */

/**
 * Non-streaming response from POST .../methods/:methodId/invoke and
 * POST .../methods/:methodId/invoke-as.
 *
 * Common fields are present on both routes. Route-specific extras:
 *   invoke:    $dev is set to true when running against a dev session.
 *   invoke-as: $impersonated carries the applied userId / roles.
 */
export interface MethodsInvokeResult {
  /** Method return value; shape is method-specific. */
  output: unknown;
  $releaseId: string;
  $methodId: string;
  $durationMs: number;
  /** Present when the invocation ran against a dev release session. */
  $dev?: true;
  /** Present only on invoke-as: the impersonation context that was applied. */
  $impersonated?: {
    userId?: string;
    roles?: string[];
  };
}
