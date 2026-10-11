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
  // Without this, `next dev` writes untracked `AGENTS.md` and `CLAUDE.md` into the app
  // directory whenever it detects an AI coding agent, against the docs policy that keeps
  // `.md` files under `docs/`. Mirrors `agentGuidance: false` in `turbo.json`.
  agentRules: false,
  // `turbopack.root` / `outputFileTracingRoot` must be an ancestor of the app,
  // the `packages/ui` source it imports, AND wherever `next` resolves from. With
  // pnpm's global virtual store DISABLED (ADR-0019), `next` resolves from the
  // in-repo `node_modules`, so the monorepo root is a valid ancestor — replacing the
  // former `os.homedir()` (needed only while the store lived under $HOME). Repo-scoping
  // also bounds Turbopack's scan for `next dev`, which runs Turbopack (Next 16's default),
  // as well as for the production build (SMELL-52's runaway-OOM insurance).
  // In Docker (root user, app at `/app`) the Dockerfile still sets
  // `NEXT_TURBOPACK_ROOT` to the container workspace root. See ADR-0017 §4 / ADR-0019.
  turbopack: {
    root: process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  },
  outputFileTracingRoot:
    process.env.NEXT_TURBOPACK_ROOT ?? path.resolve(import.meta.dirname, "../.."),
  experimental: {
    optimizePackageImports: ["lucide-react", "@packages/ui", "recharts", "date-fns"],
  },
};

const config = withNextIntl(nextConfig);

export default withSentryConfig(config, {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});
