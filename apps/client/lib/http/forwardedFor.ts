/**
 * @file forwardedFor.ts
 * @description Pure inbound→outbound relay of the client-IP forwarding headers
 *              for the client portal's server-side backend egress. Reads the real
 *              inbound client IP from `x-forwarded-for` (else `x-real-ip`) and
 *              returns the header(s) to copy verbatim onto the outbound backend
 *              `fetch`, so the backend's trusted-hop `resolveClientIp` selection
 *              (`chain[len - TRUSTED_PROXY_HOP_COUNT]`) keys the per-IP AUTH rate
 *              limiter by the REAL client rather than the Next server's socket
 *              address. RELAY, not append: Next's server-side `fetch` adds no
 *              `X-Forwarded-For` hop, so the backend's hop count is unchanged.
 *              Returns `{}` when neither header is present — the backend then
 *              falls back to its socket peer exactly as before (no regression).
 * @layer infrastructure
 */

const FORWARDED_FOR_HEADER = "x-forwarded-for";
const REAL_IP_HEADER = "x-real-ip";

/**
 * @function forwardedForHeaders
 * @description Compute the client-IP relay headers to copy onto an outbound
 *   backend request. Preserves the original header NAME so the backend applies
 *   its existing two-tier trusted-hop logic — `X-Forwarded-For` hop selection,
 *   then `X-Real-IP` direct — exactly as if the trusted edge had reached it
 *   directly. It never trusts or rewrites the value: the leftmost `X-Forwarded-For`
 *   entry stays client-spoofable on the wire and is ignored by the backend's
 *   `len - TRUSTED_PROXY_HOP_COUNT` selection, not by this helper.
 * @param inbound - The inbound request headers reaching this Next egress point.
 * @returns A header map to spread onto the outbound `fetch` headers; `{}` when
 *   no client-IP header is present.
 */
export function forwardedForHeaders(inbound: Headers): Record<string, string> {
  const forwardedFor = inbound.get(FORWARDED_FOR_HEADER);
  if (forwardedFor) return { [FORWARDED_FOR_HEADER]: forwardedFor };

  const realIp = inbound.get(REAL_IP_HEADER);
  if (realIp) return { [REAL_IP_HEADER]: realIp };

  return {};
}
