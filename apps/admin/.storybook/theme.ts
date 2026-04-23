/**
 * @file theme.ts
 * @description Storybook theme configuration for the admin app. Uses a distinct brand title
 *              ("Admin Dashboard Design System") from the client theme so devs can tell the
 *              two Storybooks apart when running in parallel.
 * @layer infrastructure
 */
import { create } from "storybook/theming/create";

export default create({
  base: "light",
  brandTitle: "Admin Dashboard Design System",
  brandUrl: "/",
  brandImage: undefined,
  brandTarget: "_self",

  // UI
  appBg: "#ffffff",
  appContentBg: "#ffffff",
  appPreviewBg: "#ffffff",
  appBorderColor: "#e5e7eb",
  appBorderRadius: 8,

  // Typography
  fontBase: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontCode: '"Fira Code", "Consolas", "Monaco", monospace',

  // Text colors
  textColor: "#1f2937",
  textInverseColor: "#ffffff",

  // Toolbar default and active colors
  barTextColor: "#6b7280",
  barSelectedColor: "#3b82f6",
  barBg: "#f9fafb",

  // Form colors
  inputBg: "#ffffff",
  inputBorder: "#d1d5db",
  inputTextColor: "#1f2937",
  inputBorderRadius: 6,

  // Brand colors
  colorPrimary: "#3b82f6",
  colorSecondary: "#6b7280",
});
