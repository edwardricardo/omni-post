import os from "node:os";
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // pnpm strict places packages in ~/.local/share/pnpm/store/ (outside the
  // project root); Turbopack follows realpath through symlinks and refuses to
  // compile files outside `turbopack.root`. Set it to $HOME so the path
  // encompasses BOTH the project AND the pnpm store, per the Next docs note
  // on linked-dependency setups (npm/yarn/pnpm link, pnpm strict, etc.).
  turbopack: { root: os.homedir() },
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

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
