/**
 * @file MentionsFeed.test.tsx
 * @description Component tests for MentionsFeed — renders author, body, badges,
 *              and external link per mention, and the empty message.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { MentionsFeed } from "../../app/[locale]/dashboard/listening/components/MentionsFeed.js";
import { IntlTestProvider } from "../intl-test-utils.js";
import type { Mention } from "@/hooks/api/useListening";

function makeMention(overrides: Partial<Mention> = {}): Mention {
  return {
    id: "m1",
    provider: "X",
    source: "SEARCH",
    trackedTermKind: "BRAND",
    authorName: "Jane Fan",
    authorHandle: "janefan",
    authorAvatarUrl: null,
    authorProviderId: "u1",
    url: "https://x.com/i/web/status/1",
    body: "Great product launch",
    lang: "en",
    sentimentScore: null,
    sentimentLabel: null,
    providerCreatedAt: "2026-05-20T10:00:00.000Z",
    ...overrides,
  };
}

function renderFeed(mentions: Mention[]) {
  return render(
    <IntlTestProvider>
      <MentionsFeed mentions={mentions} />
    </IntlTestProvider>
  );
}

describe("MentionsFeed", () => {
  it("renders author, body, provider/kind badges and the external link", () => {
    renderFeed([makeMention()]);

    expect(screen.getByText("Jane Fan")).toBeInTheDocument();
    expect(screen.getByText("Great product launch")).toBeInTheDocument();
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Marca")).toBeInTheDocument(); // BRAND → es label
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://x.com/i/web/status/1");
  });

  it("shows the empty message when there are no mentions", () => {
    renderFeed([]);
    expect(screen.getByText("No hay menciones en este período.")).toBeInTheDocument();
  });
});
