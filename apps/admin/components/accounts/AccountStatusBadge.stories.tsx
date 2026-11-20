/**
 * @file AccountStatusBadge.stories.tsx
 * @description Storybook stories for AccountStatusBadge, which picks one label and colour from an
 *              account's state: an active account, a suspended one, one on trial with its days
 *              left, and a suspended account still on trial, where suspension wins. Each story
 *              asserts the label and the colour token it is drawn in.
 *              States covered: default (Active, Trial) and error (Suspended,
 *              SuspendedDuringTrial).
 *              Absent by decision: disabled and loading, because the badge is a static label
 *              computed from an account already loaded; empty, because it always renders one of
 *              the three labels.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { tokenColor } from "@packages/ui/storybook";
import { expect } from "storybook/test";
import type { AccountSummary } from "@/lib/apiClient";
import { AccountStatusBadge } from "./AccountStatusBadge";

const makeAccount = (
  overrides: Partial<Pick<AccountSummary, "isActive" | "trial">> = {}
): AccountSummary => ({
  id: "account-001",
  email: "owner@example.com",
  name: "Example Account",
  isActive: true,
  createdAt: "2026-01-15T09:00:00Z",
  lastLoginAt: "2026-11-19T08:30:00Z",
  plan: {
    type: "bundle",
    name: "Bundle",
    status: "active",
    providers: ["x", "instagram"],
    pricePerMonth: 49,
  },
  trial: { isOnTrial: false, trialDaysRemaining: 0, trialExpired: false },
  usage: { projectsUsed: 2, projectsRemaining: 3, utilizationPercent: 40 },
  ...overrides,
});

const meta = {
  title: "Admin/Accounts/AccountStatusBadge",
  component: AccountStatusBadge,
  args: {
    account: makeAccount(),
  },
} satisfies Meta<typeof AccountStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Active");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--success"));
  },
};

export const Suspended: Story = {
  args: { account: makeAccount({ isActive: false }) },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Suspended");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--error"));
  },
};

export const Trial: Story = {
  args: {
    account: makeAccount({
      trial: { isOnTrial: true, trialDaysRemaining: 12, trialExpired: false },
    }),
  },
  play: async ({ canvas }) => {
    const badge = canvas.getByText("Trial (12d)");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--warning"));
  },
};

export const SuspendedDuringTrial: Story = {
  args: {
    account: makeAccount({
      isActive: false,
      trial: { isOnTrial: true, trialDaysRemaining: 12, trialExpired: false },
    }),
  },
  play: async ({ canvas, canvasElement }) => {
    const badge = canvas.getByText("Suspended");
    await expect(badge).toBeVisible();
    await expect(getComputedStyle(badge).color).toBe(tokenColor(badge, "--error"));
    // Suspension wins over the trial: the badge is the only element carrying text and the
    // story's whole text is its label, so no trial label sits beside it, whatever its wording.
    await expect(canvas.getAllByText(/\S/)).toEqual([badge]);
    await expect(canvasElement.textContent).toBe("Suspended");
  },
};
