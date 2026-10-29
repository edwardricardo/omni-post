/**
 * @file calendarLocaleFormatting.test.tsx
 * @description Pins every date and time the scheduling calendars and the recurring-post card
 *   show to the active UI locale: rendered under `es`, each shape reads in Spanish; rendered under
 *   `en`, each keeps the English text it had when the components named `en-US`. The hour gutters
 *   keep their English labels byte for byte. Dates are built from local wall-clock parts, so the
 *   assertions hold in any time zone the suite runs in, and the day calendar's suite pins the clock
 *   to another day, because the day the fixture names carries a "today" badge in its heading when
 *   the suite happens to run on it.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderInLocale, type TestLocale } from "../../intl-test-utils";
import { CalendarView } from "@/components/scheduling/views/CalendarView";
import { WeekCalendar } from "@/components/scheduling/WeekCalendar";
import { DayCalendar } from "@/components/scheduling/DayCalendar";
import { SchedulingDashboardCalendar } from "@/components/scheduling/SchedulingDashboardCalendar";
import { RecurringPostCard } from "@/components/scheduling/RecurringPostCard";
import type { DashboardScheduledPost } from "@/components/scheduling/schedulingDashboardTypes";
import type { RecurringPost } from "@/hooks/api/useRecurringPosts";

/** Thursday 29 October 2026, 14:07 in the zone the suite runs in. */
const THURSDAY_AFTERNOON = new Date(2026, 9, 29, 14, 7);

const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ES_WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const EN_HOURS = [
  "12 AM",
  "1 AM",
  "2 AM",
  "3 AM",
  "4 AM",
  "5 AM",
  "6 AM",
  "7 AM",
  "8 AM",
  "9 AM",
  "10 AM",
  "11 AM",
  "12 PM",
  "1 PM",
  "2 PM",
  "3 PM",
  "4 PM",
  "5 PM",
  "6 PM",
  "7 PM",
  "8 PM",
  "9 PM",
  "10 PM",
  "11 PM",
];
const ES_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour));

/** A scheduled post at `scheduledAt`, every other field fixed. */
function makeDashboardPost(scheduledAt: Date): DashboardScheduledPost {
  return {
    id: "post-1",
    title: "Launch teaser",
    content: { text: "Coming soon" },
    contentType: "FEED",
    platforms: ["x"],
    scheduledAt,
    status: "scheduled",
    timezone: "UTC",
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
    priority: "medium",
  };
}

/** A recurring post whose next occurrence is `nextScheduledAt`. */
function makeRecurringPost(nextScheduledAt: Date): RecurringPost {
  return {
    id: "recurring-1",
    name: "Weekly digest",
    cronExpression: "0 9 * * 1",
    timezone: "UTC",
    channels: ["channel-1"],
    contentVariation: "EXACT",
    isActive: true,
    nextScheduledAt: nextScheduledAt.toISOString(),
    occurrenceCount: 0,
    createdAt: nextScheduledAt.toISOString(),
  };
}

function renderCalendarView(locale: TestLocale) {
  return renderInLocale(
    locale,
    <CalendarView
      currentWeek={THURSDAY_AFTERNOON}
      slots={[
        {
          datetime: THURSDAY_AFTERNOON.toISOString(),
          dayOfWeek: 4,
          hour: 14,
          minute: 7,
          available: true,
        },
      ]}
      optimalTimes={[]}
      selectedProviders={[]}
      onWeekChange={vi.fn()}
      onCreateSchedule={vi.fn()}
      onSmartSchedule={vi.fn()}
    />
  );
}

function renderWeekCalendar(locale: TestLocale) {
  return renderInLocale(
    locale,
    <WeekCalendar
      currentDate={THURSDAY_AFTERNOON}
      posts={[]}
      onPostClick={vi.fn()}
      onWeekNavigate={vi.fn()}
      onToday={vi.fn()}
    />
  );
}

function renderDayCalendar(locale: TestLocale) {
  return renderInLocale(
    locale,
    <DayCalendar
      currentDate={THURSDAY_AFTERNOON}
      posts={[makeDashboardPost(THURSDAY_AFTERNOON)]}
      onPostClick={vi.fn()}
      onDayNavigate={vi.fn()}
      onToday={vi.fn()}
    />
  );
}

function renderDashboardCalendar(locale: TestLocale) {
  return renderInLocale(
    locale,
    <SchedulingDashboardCalendar
      currentDate={THURSDAY_AFTERNOON}
      calendarDays={[]}
      onDateSelect={vi.fn()}
      onPostClick={vi.fn()}
      onMonthNavigate={vi.fn()}
      onToday={vi.fn()}
    />
  );
}

describe("CalendarView dates and times", () => {
  it("shows the month, weekdays, slot time and accessible names in Spanish on the es interface", () => {
    renderCalendarView("es");

    expect(screen.getByRole("heading", { name: "octubre de 2026" })).toBeInTheDocument();
    for (const weekday of ES_WEEKDAYS) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }
    expect(screen.getByText("14:07")).toBeInTheDocument();
    expect(screen.getByLabelText("Espacio a las 14:07:00 — disponible")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agregar publicación el 29/10/2026" })
    ).toBeInTheDocument();
  });

  it("keeps the month, weekdays, slot time and accessible names in English on the en interface", () => {
    renderCalendarView("en");

    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    for (const weekday of EN_WEEKDAYS) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }
    expect(screen.getByText("02:07 PM")).toBeInTheDocument();
    expect(screen.getByLabelText("Slot at 2:07:00 PM — available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add post on 10/29/2026" })).toBeInTheDocument();
  });
});

describe("WeekCalendar dates and hours", () => {
  it("shows the week range, weekdays and hour gutter in Spanish on the es interface", () => {
    renderWeekCalendar("es");

    expect(screen.getByRole("heading", { name: "25 oct - 31 oct 2026" })).toBeInTheDocument();
    for (const weekday of ES_WEEKDAYS) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }
    const dayNumbers = ["25", "26", "27", "28", "29", "30", "31"];
    expect(screen.getAllByText(/^\d{1,2}$/).map((label) => label.textContent)).toEqual([
      ...dayNumbers,
      ...ES_HOURS.slice(6),
    ]);
    expect(screen.queryByText(/\b(AM|PM)$/)).toBeNull();
  });

  it("keeps the week range, weekdays and hour gutter in English on the en interface", () => {
    renderWeekCalendar("en");

    expect(screen.getByRole("heading", { name: "Oct 25 - Oct 31, 2026" })).toBeInTheDocument();
    for (const weekday of EN_WEEKDAYS) {
      expect(screen.getByText(weekday)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^\d{1,2} (AM|PM)$/).map((label) => label.textContent)).toEqual(
      EN_HOURS.slice(6)
    );
  });
});

describe("DayCalendar dates and hours", () => {
  /** Tuesday 27 October 2026, 09:00: a day that is never THURSDAY_AFTERNOON, so no today badge. */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 9, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the day, the post time and the hour gutter in Spanish on the es interface", () => {
    renderDayCalendar("es");

    expect(
      screen.getByRole("heading", { name: "jueves, 29 de octubre de 2026" })
    ).toBeInTheDocument();
    expect(screen.getByText("14:07")).toBeInTheDocument();
    expect(screen.getAllByText(/^\d{1,2}$/).map((label) => label.textContent)).toEqual(ES_HOURS);
    expect(screen.queryByText(/\b(AM|PM)$/)).toBeNull();
  });

  it("keeps the day, the post time and the hour gutter in English on the en interface", () => {
    renderDayCalendar("en");

    expect(screen.getByRole("heading", { name: "Thursday, October 29, 2026" })).toBeInTheDocument();
    expect(screen.getByText("2:07 PM")).toBeInTheDocument();
    expect(screen.getAllByText(/^\d{1,2} (AM|PM)$/).map((label) => label.textContent)).toEqual(
      EN_HOURS
    );
  });
});

describe("SchedulingDashboardCalendar month heading", () => {
  it("names the month in Spanish on the es interface", () => {
    renderDashboardCalendar("es");

    expect(screen.getByRole("heading", { name: "octubre de 2026" })).toBeInTheDocument();
  });

  it("keeps the English month on the en interface", () => {
    renderDashboardCalendar("en");

    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });
});

describe("RecurringPostCard next occurrence", () => {
  it("shows the next occurrence in Spanish on the es interface", () => {
    renderInLocale(
      "es",
      <RecurringPostCard
        post={makeRecurringPost(THURSDAY_AFTERNOON)}
        onDeactivate={vi.fn()}
        isDeactivating={false}
      />
    );

    expect(screen.getByText("Próxima: 29 oct 2026, 14:07")).toBeInTheDocument();
  });

  it("shows the next occurrence in English on the en interface, where it used to read in Spanish", () => {
    renderInLocale(
      "en",
      <RecurringPostCard
        post={makeRecurringPost(THURSDAY_AFTERNOON)}
        onDeactivate={vi.fn()}
        isDeactivating={false}
      />
    );

    expect(screen.getByText("Next: Oct 29, 2026, 2:07 PM")).toBeInTheDocument();
  });
});
