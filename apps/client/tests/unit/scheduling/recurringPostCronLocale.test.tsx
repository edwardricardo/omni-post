/**
 * @file recurringPostCronLocale.test.tsx
 * @description Pins the schedule a recurring post card shows for its cron expression: in the
 *   language of the active UI locale, on a 24-hour clock, and the raw expression when it cannot
 *   be read.
 * @layer infrastructure
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderInLocale, type TestLocale } from "../../intl-test-utils";
import { RecurringPostCard } from "@/components/scheduling/RecurringPostCard";
import type { RecurringPost } from "@/hooks/api/useRecurringPosts";

function makePost(cronExpression: string): RecurringPost {
  return {
    id: "recurring-1",
    name: "Monday digest",
    cronExpression,
    timezone: "UTC",
    channels: ["channel-1"],
    contentVariation: "EXACT",
    isActive: true,
    occurrenceCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

function renderCard(locale: TestLocale, cronExpression: string) {
  return renderInLocale(
    locale,
    <RecurringPostCard
      post={makePost(cronExpression)}
      onDeactivate={vi.fn()}
      isDeactivating={false}
    />
  );
}

describe("RecurringPostCard schedule", () => {
  it("describes the cron in Spanish on the es interface", () => {
    renderCard("es", "0 14 * * 1");

    expect(screen.getByText("A las 14:00, s\u00F3lo el lunes")).toBeInTheDocument();
  });

  it("describes the cron in English on a 24-hour clock on the en interface", () => {
    renderCard("en", "0 14 * * 1");

    expect(screen.getByText("At 14:00, only on Monday")).toBeInTheDocument();
  });

  it.each<TestLocale>(["en", "es"])(
    "shows an unreadable cron as typed on the %s interface",
    (locale) => {
      renderCard(locale, "not a cron");

      expect(screen.getByText("not a cron")).toBeInTheDocument();
    }
  );
});
