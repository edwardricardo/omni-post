/**
 * @file ipAllowlistMiddleware.ts
 * @description Fastify middleware that enforces IP allowlist from SecuritySettings.
 *   Only active when SecuritySettings.ipAllowlistEnabled=true and ipAllowlist is non-empty.
 *   Reads settings from DB with 60s cache TTL to avoid DB hammering.
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import * as ipaddr from "ipaddr.js";
import { createLogger } from "../lib/logger.js";
import { resolveClientIp } from "./resolveClientIp.js";

const allowlistLogger = createLogger("ip-allowlist");

interface AllowlistCache {
  enabled: boolean;
  list: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: AllowlistCache | null = null;

/** Routes exempt from IP allowlist enforcement */
const EXEMPT_PATHS = new Set([
  "/health",
  "/metrics",
  "/settings/public",
  "/admin/auth/login",
  "/admin/auth/password/reset",
  "/admin/auth/password/reset/confirm",
]);

/**
 * @description Reads SecuritySettings from DB with 60s cache.
 */
async function getSettings(prisma: PrismaClient): Promise<{ enabled: boolean; list: string[] }> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { enabled: cache.enabled, list: cache.list };
  }

  const settings = await prisma.securitySettings.findFirst({
    select: { ipAllowlistEnabled: true, ipAllowlist: true },
  });

  const result = {
    enabled: settings?.ipAllowlistEnabled ?? false,
    list: settings?.ipAllowlist ?? [],
  };

  cache = { ...result, expiresAt: now + CACHE_TTL_MS };
  return result;
}

/**
 * @description Checks if an IP matches any entry in the allowlist (exact or CIDR).
 */
function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(clientIp);
  } catch {
    return false;
  }

  return allowlist.some((entry) => {
    try {
      if (entry.includes("/")) {
        const cidr = ipaddr.parseCIDR(entry);
        return addr.match(cidr);
      }
      return addr.toString() === ipaddr.parse(entry).toString();
    } catch {
      return false;
    }
  });
}

/**
 * @function createIpAllowlistMiddleware
 * @description Creates a Fastify onRequest hook that enforces IP allowlist.
 *   Skips enforcement when disabled, list empty, or route is exempt.
 * @param prisma - Prisma client for reading SecuritySettings
 * @returns Fastify onRequest hook function
 */
export function createIpAllowlistMiddleware(prisma: PrismaClient) {
  return async function ipAllowlistHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const path = request.url.split("?")[0] ?? request.url;
    if (EXEMPT_PATHS.has(path)) return;
    if (!path.startsWith("/admin/")) return;

    const settings = await getSettings(prisma);
    if (!settings.enabled || settings.list.length === 0) return;

    const clientIp = resolveClientIp(request);

    if (!isIpAllowed(clientIp, settings.list)) {
      allowlistLogger.warn({ clientIp }, "IP not in allowlist — access denied");
      return reply.status(403).send({
        ok: false,
        error: { code: "IP_NOT_ALLOWED", message: "Access denied: IP not in allowlist" },
      });
    }
  };
}

/** @description Clears the cached settings (for testing). */
export function clearAllowlistCache(): void {
  cache = null;
}
