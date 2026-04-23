/**
 * @file theme.ts
 * @description Storybook theme configuration for the client app design system, defining brand,
 *              typography, colors, and social platform brand color palette.
 * @layer infrastructure
 */
import { create } from "storybook/theming/create";

export default create({
  base: "light",
  brandTitle: "Social Media CMS Design System",
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

// Social media brand colors for social platform components (not part of Storybook theme API)
export const socialBrandColors = {
  twitter: "#1da1f2",
  instagram: "#e4405f",
  facebook: "#1877f2",
  linkedin: "#0a66c2",
  tiktok: "#000000",
  youtube: "#ff0000",
} as const;
