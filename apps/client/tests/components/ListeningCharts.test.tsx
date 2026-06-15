/**
 * @file ListeningCharts.test.tsx
 * @description Smoke tests for the listening charts: they mount with data without
 *              throwing (recharts geometry is not asserted — jsdom lacks layout).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { ShareOfVoiceChart } from "../../app/[locale]/dashboard/listening/components/ShareOfVoiceChart.js";
import { SentimentBreakdownChart } from "../../app/[locale]/dashboard/listening/components/SentimentBreakdownChart.js";
import { IntlTestProvider } from "../intl-test-utils.js";

describe("listening charts", () => {
  it("ShareOfVoiceChart mounts with per-provider data", () => {
    const { container } = render(
      <IntlTestProvider>
        <ShareOfVoiceChart
          data={[{ provider: "X", brandCount: 5, marketCount: 2, totalCount: 7, sov: 2.5 }]}
        />
      </IntlTestProvider>
    );
    expect(container.querySelector("figure")).toBeInTheDocument();
  });

  it("SentimentBreakdownChart mounts with sentiment data", () => {
    const { container } = render(
      <IntlTestProvider>
        <SentimentBreakdownChart data={{ positive: 1, neutral: 2, negative: 0, unscored: 9 }} />
      </IntlTestProvider>
    );
    expect(container.querySelector("figure")).toBeInTheDocument();
  });
});
