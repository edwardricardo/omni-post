/**
 * @file Badge.stories.tsx
 * @description Storybook stories for the admin Badge: one story per semantic variant (success,
 *              warning, error, info, neutral) at the default size, and the compact size, each
 *              asserting its label and that it is drawn in its variant's colour token.
 *              States covered: default (each variant, both sizes); the error variant is the
 *              badge's own failure colour.
 *              Absent by decision: disabled and loading, because a badge is a static label with
 *              no interaction and no pending phase; empty, because a badge without content
 *              conveys nothing and callers render one only when there is a status to show.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { tokenColor } from "@packages/ui/storybook";
import { expect } from "storybook/test";
import { Badge } from "./Badge";

const meta = {
  title: "Admin/UI/Badge",
  component: Badge,
  argTypes: {
    variant: {
      control: "select",
      options: ["success", "warning", "error", "info", "neutral"],
      description: "Semantic colour of the pill",
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md"],
      description: "Pill density",
    },
    children: {
      control: "text",
      description: "Badge content",
    },
  },
  args: {
    variant: "success",
    children: "Active",
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Active");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--success"));
  },
};

export const Warning: Story = {
  args: { variant: "warning", children: "Trial" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Trial");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--warning"));
  },
};

export const ErrorVariant: Story = {
  args: { variant: "error", children: "Suspended" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Suspended");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--error"));
  },
};

export const Info: Story = {
  args: { variant: "info", children: "Enterprise" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Enterprise");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--accent"));
  },
};

export const Neutral: Story = {
  args: { variant: "neutral", children: "Inactive" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Inactive");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--text-secondary"));
  },
};

export const Small: Story = {
  args: { size: "sm", variant: "info", children: "3 projects" },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("3 projects");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--accent"));
  },
};
