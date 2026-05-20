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
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3000/:path*", // Proxy to API server
      },
    ];
  },
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
