/**
 * @file channelDateFormatters.test.tsx
 * @description Pins the channels page's date helpers and texts to the active UI locale: the date
 *   with time (last used, connected) and the date alone (the expiry badge) read in Spanish for
 *   `es` and keep the English text they had when the helpers named `en-US` for `en`; the missing
 *   date and the four status pills read their catalog text, in Spanish under `es` and in the
 *   English they had before under `en`. Dates are built from local wall-clock parts, so the
 *   assertions hold in any time zone the suite runs in.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderInLocale, type TestLocale } from "../../intl-test-utils";
import { formatDate, formatDay } from "@/app/[locale]/dashboard/channels/components/formatters";
import { ChannelsTable } from "@/app/[locale]/dashboard/channels/components/ChannelsTable";
import { ChannelStatusBadge } from "@/app/[locale]/dashboard/channels/components/ChannelStatusBadge";
import type { ProjectChannel } from "@/lib/hooks/useProjectChannels";

/** Thursday 29 October 2026, 14:07 in the suite's zone. */
const OCT_29 = new Date(2026, 9, 29, 14, 7).toISOString();

function makeChannel(overrides: Partial<ProjectChannel> = {}): ProjectChannel {
  return {
    id: "channel-1",
    projectId: "project-1",
    projectName: "Main",
    name: "@acme",
    platform: "X",
    provider: "X",
    providerName: "X (Twitter)",
    handle: "acme",
    accountName: "@acme",
    profileImage: null,
    isPrimary: false,
    isConnected: true,
    needsReauth: false,
    status: "CONNECTED",
    connectedAt: OCT_29,
    expiredAt: null,
    lastUsedAt: OCT_29,
    usage: { postsThisMonth: 2 },
    createdAt: OCT_29,
    updatedAt: OCT_29,
    ...overrides,
  };
}

function renderTable(locale: TestLocale, channel: ProjectChannel = makeChannel()) {
  return renderInLocale(
    locale,
    <ChannelsTable
      channels={[channel]}
      selectedChannels={new Set()}
      onSelectChannel={vi.fn()}
      onDisconnect={vi.fn()}
    />
  );
}

describe("formatDate", () => {
  it("formats the date and time in Spanish for es", () => {
    expect(formatDate(OCT_29, "es", "Nunca")).toBe("29 oct 2026, 14:07");
  });

  it("keeps the English date and time for en", () => {
    expect(formatDate(OCT_29, "en", "Never")).toBe("Oct 29, 2026, 02:07 PM");
  });

  it("returns the label its caller passes when there is no date", () => {
    expect(formatDate(null, "es", "Nunca")).toBe("Nunca");
  });
});

describe("formatDay", () => {
  it("formats the date in Spanish for es", () => {
    expect(formatDay(OCT_29, "es")).toBe("29 oct 2026");
  });

  it("keeps the English date for en", () => {
    expect(formatDay(OCT_29, "en")).toBe("Oct 29, 2026");
  });

  it("returns an empty string when there is no date", () => {
    expect(formatDay(null, "es")).toBe("");
  });
});

describe("ChannelsTable dates", () => {
  it("shows the last-used and connected dates in Spanish on the es interface", () => {
    renderTable("es");

    expect(screen.getAllByText("29 oct 2026, 14:07")).toHaveLength(2);
  });

  it("keeps the English last-used and connected dates on the en interface", () => {
    renderTable("en");

    expect(screen.getAllByText("Oct 29, 2026, 02:07 PM")).toHaveLength(2);
  });

  it("says never in Spanish for a channel never used on the es interface", () => {
    renderTable("es", makeChannel({ lastUsedAt: null }));

    expect(screen.getByText("Nunca")).toBeInTheDocument();
  });

  it("keeps the English never for a channel never used on the en interface", () => {
    renderTable("en", makeChannel({ lastUsedAt: null }));

    expect(screen.getByText("Never")).toBeInTheDocument();
  });
});

describe("ChannelStatusBadge", () => {
  const CASES: Array<{
    state: string;
    channel: Partial<ProjectChannel>;
    es: string;
    en: string;
  }> = [
    {
      state: "an expired channel",
      channel: { isConnected: false, expiredAt: OCT_29 },
      es: "Expiró el 29 oct 2026",
      en: "Expired on Oct 29, 2026",
    },
    {
      state: "a channel that needs reauthorization",
      channel: { needsReauth: true },
      es: "Requiere reconexión",
      en: "Reconnect required",
    },
    {
      state: "a disconnected channel",
      channel: { isConnected: false },
      es: "Desconectado",
      en: "Disconnected",
    },
    { state: "a connected channel", channel: {}, es: "Conectado", en: "Connected" },
  ];

  it.each(CASES)("labels $state in Spanish on the es interface", ({ channel, es }) => {
    renderInLocale("es", <ChannelStatusBadge channel={makeChannel(channel)} />);

    expect(screen.getByText(es)).toBeInTheDocument();
  });

  it.each(CASES)("keeps the English label of $state on the en interface", ({ channel, en }) => {
    renderInLocale("en", <ChannelStatusBadge channel={makeChannel(channel)} />);

    expect(screen.getByText(en)).toBeInTheDocument();
  });
});
