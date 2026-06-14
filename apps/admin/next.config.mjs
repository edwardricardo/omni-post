import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Dev access goes through the homelab Tailscale hostname (omnipost-dev), not
  // localhost. Next 16 blocks the HMR WebSocket and rejects Server Actions from
  // cross-origin dev requests unless the origin is allowlisted here. Without it
  // the login form's Server Action is silently rejected ("button does nothing").
  allowedDevOrigins: ["omnipost-dev"],
  // Turbopack refuses to compile files outside `turbopack.root`, and Next
  // standalone traces deps from `outputFileTracingRoot`. Both must point at the
  // monorepo root — an ancestor of the project in dev, CI, AND Docker. The old
  // `os.homedir()` broke in Docker (root user → `/root`, not an ancestor of
  // `/app/apps/admin` → "Invalid distDirRoot"). The env override lets CI/Docker
  // pin it explicitly; default is the computed workspace root.
  turbopack: {
    root: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  },
  outputFileTracingRoot: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  experimental: {
    optimizePackageImports: ["lucide-react", "@packages/ui", "recharts", "date-fns"],
  },
};

const config = withNextIntl(nextConfig);

export default withSentryConfig(config, {
  silent: true,
  disableLogger: true,
});
