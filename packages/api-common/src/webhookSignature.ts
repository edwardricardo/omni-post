/**
 * @file webhookSignature.ts
 * @description Framework-neutral HMAC webhook signature verification utilities.
 *              Pure functions — no Fastify, no Request/Reply types, no logger
 *              dependency. Caller decides how to handle errors. Used both by
 *              `BaseRouteHandler.verifyWebhookSignature` (thin wrapper) and by
 *              the worker-side `AbstractWebhookProcessor` to avoid duplication.
 * @layer infrastructure
 */
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Options for HMAC webhook signature verification.
 */
export interface WebhookVerificationOptions {
  algorithm?: "sha256" | "sha1";
  encoding?: "hex" | "base64";
  /**
   * When true, common provider prefixes like `sha256=` (Instagram / Facebook)
   * are stripped from the incoming `signature` before comparison.
   */
  removePrefix?: boolean;
  /**
   * Optional sink for the rare verification-time exception (e.g. invalid
   * encoding). When omitted, errors are silently coerced to `false`. The
   * helper never throws — verification always returns a boolean.
   */
  onError?: (error: unknown) => void;
}

/**
 * @method verifyWebhookSignature
 * @description Verifies an HMAC signature against a payload + secret using a
 *   constant-time comparison so signature checks are safe against timing
 *   attacks. Always returns a boolean (errors during verification are
 *   reported through `options.onError` if supplied, otherwise swallowed and
 *   treated as a verification failure).
 *
 *   Provider-specific examples:
 *   - X (Twitter): HMAC-SHA256, base64 or hex, header `x-signature`.
 *   - Instagram / Facebook: HMAC-SHA256, hex, header `x-hub-signature-256`,
 *     prefix `sha256=` (set `removePrefix: true`).
 *   - TikTok / YouTube: HMAC-SHA256, hex (provider-specific headers).
 * @param payload - Raw body the provider signed (string).
 * @param signature - Signature reported by the provider.
 * @param secret - Shared secret negotiated with the provider.
 * @param options - Hash algorithm, output encoding, and optional prefix strip.
 * @returns `true` when the signature matches; `false` otherwise.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  options?: WebhookVerificationOptions
): boolean {
  const algorithm = options?.algorithm ?? "sha256";
  const encoding = options?.encoding ?? "hex";
  const removePrefix = options?.removePrefix ?? false;

  try {
    let cleanSignature = signature;
    if (removePrefix) {
      cleanSignature = signature.replace(/^sha256=|^sha1=/i, "");
    }

    const hmac = createHmac(algorithm, secret);
    hmac.update(payload, "utf8");
    const expectedSignature = hmac.digest(encoding);

    return constantTimeCompare(cleanSignature, expectedSignature);
  } catch (error) {
    options?.onError?.(error);
    return false;
  }
}

/**
 * @method constantTimeCompare
 * @description Compares two strings in constant time to prevent timing-attack
 *   leaks. Falls back to manual bitwise XOR when the byte lengths differ
 *   (`timingSafeEqual` requires equal-length buffers).
 * @returns `true` when the strings are byte-for-byte equal.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");

    if (bufA.length !== bufB.length) {
      return false;
    }

    return timingSafeEqual(new Uint8Array(bufA), new Uint8Array(bufB));
  } catch {
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
