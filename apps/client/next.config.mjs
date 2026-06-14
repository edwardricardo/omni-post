import path from "node:path";
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
  // Turbopack refuses to compile files outside `turbopack.root`, and Next
  // standalone traces deps from `outputFileTracingRoot`. Both must point at the
  // monorepo root — an ancestor of the project in dev, CI, AND Docker. The old
  // `os.homedir()` broke in Docker (root user → `/root`, not an ancestor of
  // `/app/apps/client` → "Invalid distDirRoot"). The env override lets CI/Docker
  // pin it explicitly; default is the computed workspace root.
  turbopack: {
    root: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  },
  outputFileTracingRoot: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
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
