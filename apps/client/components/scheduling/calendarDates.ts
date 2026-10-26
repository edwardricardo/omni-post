/**
 * @file calendarDates.ts
 * @description Date helpers shared by the day and week calendars: the same-day comparison in
 *   local time, and the hour gutter's label in the active UI locale.
 * @layer infrastructure
 */

/**
 * @description Tells whether two instants fall on the same calendar day in the local time zone.
 * @param a - First instant.
 * @param b - Second instant.
 * @returns True when their local year, month and day match.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * @description Labels a row of the hour gutter: the hour alone, in the locale's clock.
 * @param hour - Hour of the day, 0 to 23.
 * @param locale - The active UI locale.
 * @returns "6 AM" or "11 PM" in English, "6" or "23" in Spanish.
 */
export function formatHourLabel(hour: number, locale: string): string {
  // Any day works: only the hour is shown.
  return new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: "numeric" });
}
