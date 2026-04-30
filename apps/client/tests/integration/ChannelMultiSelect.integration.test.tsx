/**
 * @file ChannelMultiSelect.integration.test.tsx
 * @description Integration tests for the shared ChannelMultiSelect component
 *              (lives in `packages/ui`). Verifies the smart-default pre-selection,
 *              the override (toggle on/off), the WAI-ARIA fieldset/legend
 *              grouping, the accessible "Default" badge, and the empty-state +
 *              link rendered when a selected provider has no connected channels.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import {
  ChannelMultiSelect,
  computeDefaultChannelSelection,
  type ChannelMultiSelectChannel,
} from "@packages/ui/components/business/ChannelMultiSelect";

const channels: ChannelMultiSelectChannel[] = [
  { id: "x-1", name: "@brand-x-primary", platform: "X", isPrimary: true },
  { id: "x-2", name: "@brand-x-secondary", platform: "X", isPrimary: false },
  { id: "ig-1", name: "@brand-instagram", platform: "INSTAGRAM", isPrimary: true },
];

describe("computeDefaultChannelSelection", () => {
  it("returns the primary channel id per selected provider", () => {
    expect(computeDefaultChannelSelection(channels, ["X", "INSTAGRAM"])).toEqual(["x-1", "ig-1"]);
  });

  it("falls back to the first channel when none is marked primary", () => {
    const noPrimary = channels.map((c) => ({ ...c, isPrimary: false }));
    expect(computeDefaultChannelSelection(noPrimary, ["X"])).toEqual(["x-1"]);
  });

  it("skips providers that have no connected channels", () => {
    expect(computeDefaultChannelSelection(channels, ["X", "TIKTOK"])).toEqual(["x-1"]);
  });
});

describe("ChannelMultiSelect", () => {
  it("renders a fieldset/legend group per selected provider", () => {
    render(
      <ChannelMultiSelect
        channels={channels}
        selectedProviders={["X", "INSTAGRAM"]}
        value={["x-1", "ig-1"]}
        onChange={() => {}}
      />
    );

    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByText("X")).toBeInTheDocument();
    expect(within(groups[1]!).getByText("INSTAGRAM")).toBeInTheDocument();
  });

  it("marks the primary channel with an accessible Default badge", () => {
    render(
      <ChannelMultiSelect
        channels={channels}
        selectedProviders={["X"]}
        value={["x-1"]}
        onChange={() => {}}
      />
    );

    const badge = screen.getByLabelText("Default channel");
    expect(badge).toHaveTextContent("Default");
  });

  it("invokes onChange when the user toggles a checkbox", () => {
    const onChange = vi.fn();

    render(
      <ChannelMultiSelect
        channels={channels}
        selectedProviders={["X"]}
        value={["x-1"]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/brand-x-secondary/));
    expect(onChange).toHaveBeenCalledWith(["x-1", "x-2"]);
  });

  it("renders the empty state with a link when a provider has no channels", () => {
    render(
      <ChannelMultiSelect
        channels={channels.filter((c) => c.platform !== "TIKTOK")}
        selectedProviders={["TIKTOK"]}
        value={[]}
        onChange={() => {}}
        noChannelsHref="/dashboard/channels"
      />
    );

    expect(screen.getByText(/No channels connected for TIKTOK/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Connect a channel/ });
    expect(link).toHaveAttribute("href", "/dashboard/channels");
  });

  it("supports custom provider labels", () => {
    render(
      <ChannelMultiSelect
        channels={channels}
        selectedProviders={["X"]}
        value={["x-1"]}
        onChange={() => {}}
        providerLabels={{ X: "Twitter / X" }}
      />
    );
    expect(screen.getByText("Twitter / X")).toBeInTheDocument();
  });

  it("renders a hint when no providers are selected", () => {
    render(
      <ChannelMultiSelect
        channels={channels}
        selectedProviders={[]}
        value={[]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Select a platform first/)).toBeInTheDocument();
  });
});
