/**
 * @file label.stories.tsx
 * @description Storybook stories for the Label component: a label naming its input, a label
 *              dimmed by the disabled control it names, and a label marking an invalid field.
 *              States covered: default (Default), disabled (Disabled) and error (Invalid).
 *              Absent by decision: loading, because a label has no pending phase; empty, because
 *              a label without text leaves its control with no accessible name, a defect for axe
 *              to fail rather than a state to show.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Label } from "./label";

const meta = {
  title: "Components/UI/Label",
  component: Label,
  parameters: {
    docs: {
      description: {
        component:
          "The accessible name of a form control. Clicking it focuses the control it names, and it dims when that control, marked with the `peer` class, is disabled.",
      },
    },
  },
  argTypes: {
    children: {
      control: "text",
      description: "Label text",
    },
  },
  args: {
    children: "Email address",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="grid w-full max-w-sm gap-2">
      <Label {...args} htmlFor="label-default-email" />
      <Input id="label-default-email" type="email" placeholder="you@example.com" />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText("Email address"));
    await expect(canvas.getByLabelText("Email address")).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: {
    children: "Accept the terms of service",
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox id="label-disabled-terms" disabled />
      <Label {...args} htmlFor="label-disabled-terms" />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Accept the terms of service")).toBeDisabled();
    // Dimmed, without pinning the utility's exact value: the stylesheet's peer-disabled rule
    // applies (an unscanned packages/ui left this at 1), whatever opacity the design sets.
    await expect(
      Number(getComputedStyle(canvas.getByText("Accept the terms of service")).opacity)
    ).toBeLessThan(1);
  },
};

export const Invalid: Story = {
  args: {
    className: "text-destructive",
  },
  render: (args) => (
    <div className="grid w-full max-w-sm gap-2">
      <Label {...args} htmlFor="label-invalid-email" />
      <Input
        id="label-invalid-email"
        type="email"
        defaultValue="ada@"
        aria-invalid="true"
        aria-describedby="label-invalid-email-message"
        className="border-destructive"
      />
      <p id="label-invalid-email-message" className="text-sm text-destructive">
        Enter a complete email address.
      </p>
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText("Email address");
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription("Enter a complete email address.");
  },
};
