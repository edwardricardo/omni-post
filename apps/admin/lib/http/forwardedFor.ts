/**
 * @file forwardedFor.ts
 * @description Client-IP relay for the admin portal. The portal proxies browser
 *              calls to the Fastify backend server-side, so from the backend's
 *              socket the peer is the portal — not the user. This helper relays
 *              the inbound client-IP header VERBATIM so the backend resolver can
 *              hop-count to the real client: it forwards the inbound
 *              `x-forwarded-for` chain unchanged (appending NO portal hop), or
 *              falls back to `x-real-ip`, or returns nothing. It never fabricates
 *              or mutates a value — the backend's hop-count math stays the sole
 *              authority (SECURITY_CANON.md §Rate Limiting).
 * @layer infrastructure
 */

/**
 * @function forwardedForHeaders
 * @description Build the client-IP relay headers to merge into an outbound
 *   server-side fetch to the backend.
 * @param inbound - The inbound request headers (from `NextRequest.headers` or
 *   `headers()` in a Server Action).
 * @returns `{ "x-forwarded-for": <verbatim> }` when the inbound request carries a
 *   non-empty XFF chain; else `{ "x-real-ip": <verbatim> }` when only X-Real-IP
 *   is present; else `{}`.
 */
export function forwardedForHeaders(inbound: Headers): Record<string, string> {
  const xff = inbound.get("x-forwarded-for");
  if (xff && xff.trim().length > 0) {
    return { "x-forwarded-for": xff };
  }
  const realIp = inbound.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return { "x-real-ip": realIp };
  }
  return {};
}
