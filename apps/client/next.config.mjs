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
  // `turbopack.root` / `outputFileTracingRoot` must be an ancestor of the app,
  // the `packages/ui` source it imports, AND wherever `next` resolves from. With
  // pnpm's global virtual store DISABLED (ADR-0019), `next` resolves from the
  // in-repo `node_modules`, so the monorepo root is a valid ancestor — replacing the
  // former `os.homedir()` (needed only while the store lived under $HOME). Repo-scoping
  // also bounds the PRODUCTION BUILD's Turbopack scan (SMELL-52's deferred insurance);
  // dev runs `next dev --webpack` (SMELL-52), so it is unaffected either way.
  // In Docker (root user, app at `/app`) the Dockerfile still sets
  // `NEXT_TURBOPACK_ROOT` to the container workspace root. See ADR-0017 §4 / ADR-0019.
  turbopack: {
    root: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  },
  outputFileTracingRoot:
    process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
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
  webpack: { treeshake: { removeDebugLogging: true } },
});
