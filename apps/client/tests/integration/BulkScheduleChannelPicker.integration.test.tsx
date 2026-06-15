/**
 * @file BulkScheduleChannelPicker.integration.test.tsx
 * @description Integration tests for BulkScheduleChannelPicker.
 *              Verifies: channel list rendering, multi-select, two same-provider
 *              channels selectable independently, confirm button disabled state,
 *              no provider dropdown (channels only).
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { ProjectChannel } from "../../lib/hooks/useProjectChannels/types.js";
import { BulkScheduleChannelPicker } from "../../components/scheduling/BulkScheduleChannelPicker.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChannel(overrides: Partial<ProjectChannel> = {}): ProjectChannel {
  return {
    id: "ch-001",
    projectId: "proj-1",
    projectName: "Acme",
    name: "@acme",
    platform: "INSTAGRAM",
    provider: "INSTAGRAM",
    providerName: "Instagram",
    handle: "@acme",
    accountName: "@acme",
    profileImage: null,
    isPrimary: true,
    isConnected: true,
    needsReauth: false,
    status: "CONNECTED",
    connectedAt: "2026-01-01T00:00:00.000Z",
    expiredAt: null,
    lastUsedAt: null,
    usage: { postsThisMonth: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const twoInstagramChannels: ProjectChannel[] = [
  makeChannel({
    id: "ig-us",
    name: "@acme_us",
    platform: "INSTAGRAM",
    provider: "INSTAGRAM",
    isPrimary: true,
  }),
  makeChannel({
    id: "ig-es",
    name: "@acme_es",
    platform: "INSTAGRAM",
    provider: "INSTAGRAM",
    isPrimary: false,
  }),
];

const crossProviderChannels: ProjectChannel[] = [
  makeChannel({ id: "x-1", name: "@acme_x", platform: "X", provider: "X", isPrimary: true }),
  makeChannel({
    id: "ig-1",
    name: "@acme_ig",
    platform: "INSTAGRAM",
    provider: "INSTAGRAM",
    isPrimary: true,
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BulkScheduleChannelPicker", () => {
  it("renders a list of channels from the project", () => {
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={[]}
        onChange={() => {}}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    expect(screen.getByText("@acme_us")).toBeInTheDocument();
    expect(screen.getByText("@acme_es")).toBeInTheDocument();
  });

  it("supports selecting two same-provider channels independently", () => {
    const onChange = vi.fn();
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={["ig-us"]}
        onChange={onChange}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    // Toggle the second Instagram channel
    fireEvent.click(screen.getByLabelText(/@acme_es/));
    expect(onChange).toHaveBeenCalledWith(["ig-us", "ig-es"]);
  });

  it("deselects a channel when it is toggled off", () => {
    const onChange = vi.fn();
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={["ig-us", "ig-es"]}
        onChange={onChange}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    fireEvent.click(screen.getByLabelText(/@acme_us/));
    expect(onChange).toHaveBeenCalledWith(["ig-es"]);
  });

  it("disables the Confirm button when no channels are selected", () => {
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={[]}
        onChange={() => {}}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("enables the Confirm button when at least one channel is selected", () => {
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={["ig-us"]}
        onChange={() => {}}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("calls onConfirm when the Confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={["ig-us"]}
        onChange={() => {}}
        onConfirm={onConfirm}
        isConfirming={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a loading state while confirming", () => {
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={["ig-us"]}
        onChange={() => {}}
        onConfirm={() => {}}
        isConfirming={true}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("renders cross-provider channels (X and Instagram) independently", () => {
    const onChange = vi.fn();
    render(
      <BulkScheduleChannelPicker
        channels={crossProviderChannels}
        selectedChannelIds={["x-1"]}
        onChange={onChange}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    expect(screen.getByText("@acme_x")).toBeInTheDocument();
    expect(screen.getByText("@acme_ig")).toBeInTheDocument();

    // Add IG channel without affecting X
    fireEvent.click(screen.getByLabelText(/@acme_ig/));
    expect(onChange).toHaveBeenCalledWith(["x-1", "ig-1"]);
  });

  it("does NOT render a provider dropdown (channels only)", () => {
    render(
      <BulkScheduleChannelPicker
        channels={twoInstagramChannels}
        selectedChannelIds={[]}
        onChange={() => {}}
        onConfirm={() => {}}
        isConfirming={false}
      />
    );

    // No combobox/select for platform selection
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
