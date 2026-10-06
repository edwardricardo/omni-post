/**
 * @file avatar.stories.tsx
 * @description Storybook stories for the Avatar component: a loaded profile image, the fallback
 *              initials shown when the image cannot be loaded, and the initial shown for a user
 *              with no image at all.
 *              States covered: default (Default), error (ImageFailed) and empty (NoImage).
 *              Absent by decision: disabled, because an avatar is not interactive; loading,
 *              because while the image loads the avatar renders its fallback, the output the
 *              ImageFailed story asserts, and keeping an image in flight would need a server that
 *              never answers.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, waitFor } from "storybook/test";
import { Avatar, AvatarFallback, AvatarImage, AvatarInitial } from "./avatar";

// Both images are data URLs, so no story depends on the network.
const PORTRAIT_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cbd5e1"/><circle cx="20" cy="15" r="7" fill="#475569"/><path d="M6 40c1-9 7-14 14-14s13 5 14 14z" fill="#475569"/></svg>'
)}`;
// The bytes of "not-an-image": the browser cannot decode them and fires the image's error event.
const UNDECODABLE_SRC = "data:image/png;base64,bm90LWFuLWltYWdl";

// Records the image's loading status, so ImageFailed can tell a failed load from one in flight:
// the fallback renders in both.
const onImageStatusChange = fn();

const meta = {
  title: "Components/UI/Avatar",
  component: Avatar,
  subcomponents: { AvatarImage, AvatarFallback, AvatarInitial },
  parameters: {
    docs: {
      description: {
        component:
          "A user's picture in a circle. AvatarImage renders only once its image has loaded; until then, or when it fails, AvatarFallback shows the user's initials. AvatarInitial is the initial shown for a user without a picture.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src={PORTRAIT_SRC} alt="Ada Lovelace" />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("img", { name: "Ada Lovelace" })).toBeVisible();
    await expect(canvas.queryByText("AL")).not.toBeInTheDocument();
  },
};

export const ImageFailed: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage
        src={UNDECODABLE_SRC}
        alt="Ada Lovelace"
        onLoadingStatusChange={onImageStatusChange}
      />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvas }) => {
    await waitFor(() => expect(onImageStatusChange).toHaveBeenLastCalledWith("error"));
    await expect(canvas.getByText("AL")).toBeVisible();
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
  },
};

export const NoImage: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarInitial>A</AvatarInitial>
    </Avatar>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("A")).toBeVisible();
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
  },
};
