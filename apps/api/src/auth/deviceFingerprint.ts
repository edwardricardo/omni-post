/**
 * @file deviceFingerprint.ts
 * @description Device fingerprint utilities for generating and hashing session fingerprints
 *              used in enhanced session security.
 * @layer infrastructure
 */

import { createHash } from "crypto";
import type { SessionFingerprint } from "./authTypes.js";

/**
 * Hash a session fingerprint into a deterministic SHA-256 hex string.
 */
export function hashFingerprint(fingerprint: SessionFingerprint): string {
  const fingerprintString = `${fingerprint.userAgent}|${fingerprint.deviceId || ""}|${fingerprint.browserFingerprint || ""}`;
  return createHash("sha256").update(fingerprintString).digest("hex");
}

/**
 * Generate a device ID from user agent and IP address.
 */
export function generateDeviceId(userAgent: string, ipAddress: string): string {
  return createHash("md5").update(`${userAgent}${ipAddress}`).digest("hex");
}

/**
 * Generate a browser fingerprint from the user agent string.
 */
export function generateBrowserFingerprint(userAgent: string): string {
  return createHash("md5").update(userAgent).digest("hex");
}
