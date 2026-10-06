/**
 * @file badge.stories.tsx
 * @description Storybook stories for the Badge component: the default status label, the
 *              secondary and outline variants, and the destructive variant that marks a failed
 *              status.
 *              States covered: default (Default, Secondary, Outline) and error (Destructive).
 *              Absent by decision: disabled and loading, because a badge is a static label with
 *              no interaction and no pending phase; empty, because a badge without content
 *              conveys nothing and callers render one only when there is a status to show.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";
import { Badge } from "./badge";

const meta = {
  title: "Components/UI/Badge",
  component: Badge,
  parameters: {
    docs: {
      description: {
        component:
          "A compact pill for a status or a count, in four variants: default, secondary, outline, and destructive for a failed status.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "outline", "destructive"],
      description: "The visual style variant of the badge",
    },
    children: {
      control: "text",
      description: "Badge content",
    },
  },
  args: {
    children: "Published",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Published")).toBeVisible();
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Draft",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Draft")).toBeVisible();
  },
};

export const Outline: Story = {
  args: {
    variant: "outline",
    children: "Scheduled",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Scheduled")).toBeVisible();
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: "Failed",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Failed")).toBeVisible();
  },
};
