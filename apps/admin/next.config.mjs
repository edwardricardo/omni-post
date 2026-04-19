import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};

const config = withNextIntl(nextConfig);

export default withSentryConfig(config, {
  silent: true,
  disableLogger: true,
});
