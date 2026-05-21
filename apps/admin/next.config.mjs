import os from "node:os";
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
  // pnpm strict places packages in ~/.local/share/pnpm/store/ (outside the
  // project root); Turbopack follows realpath through symlinks and refuses to
  // compile files outside `turbopack.root`. Set it to $HOME so the path
  // encompasses BOTH the project AND the pnpm store, per the Next docs note
  // on linked-dependency setups (npm/yarn/pnpm link, pnpm strict, etc.).
  turbopack: { root: os.homedir() },
  experimental: {
    optimizePackageImports: ["lucide-react", "@packages/ui", "recharts", "date-fns"],
  },
};

const config = withNextIntl(nextConfig);

export default withSentryConfig(config, {
  silent: true,
  disableLogger: true,
});
