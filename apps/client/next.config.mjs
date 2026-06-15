import os from "node:os";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Dev access goes through the homelab Tailscale hostname (omnipost-dev), not
  // localhost. Next 16 blocks the HMR WebSocket and rejects Server Actions from
  // cross-origin dev requests unless the origin is allowlisted here.
  allowedDevOrigins: ["omnipost-dev"],
  // `turbopack.root` / `outputFileTracingRoot` must be an ancestor of the app,
  // the `packages/ui` source it imports, AND the pnpm store where `next` resolves.
  // In dev/CI that ancestor is `os.homedir()`: the repo and pnpm's global virtual
  // store (`$HOME/.local/share/pnpm`) both live under $HOME, whereas the monorepo
  // root does NOT contain the store — so a monorepo-root value leaves Turbopack
  // unable to resolve `next` ("inferred your workspace root" error). In Docker
  // (root user, app at `/app`) $HOME is not an app ancestor, so the Dockerfile
  // sets `NEXT_TURBOPACK_ROOT` to the container workspace root. See ADR-0017 §4.
  turbopack: {
    root: process.env.NEXT_TURBOPACK_ROOT ?? os.homedir(),
  },
  outputFileTracingRoot: process.env.NEXT_TURBOPACK_ROOT ?? os.homedir(),
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // No global `/api/:path*` rewrite. All client→API traffic goes through the
  // explicit Next.js route handler `app/api/backend/[...path]/route.ts`,
  // which injects the customer Bearer token from the httpOnly session
  // cookie and handles auth-flow cookie lifecycle. A global rewrite would
  // pre-empt the route handler (Next.js evaluates rewrites before file
  // system route matching) and forward raw paths with `backend/` prefixed
  // to the API, producing 404s and stripping auth headers.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    optimizePackageImports: ["lucide-react", "@packages/ui", "recharts", "date-fns"],
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
});
