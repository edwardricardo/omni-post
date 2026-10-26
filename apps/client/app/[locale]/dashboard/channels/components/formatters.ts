/**
 * @file formatters.ts
 * @description Date helpers shared across the channels page sub-components.
 *              `formatDate` is the long form (date and time); `formatDay` is the
 *              short form used inside the "Expired on …" badge. Both format in the
 *              locale their caller passes, the active UI locale.
 * @layer infrastructure
 */

/**
 * @description Formats a timestamp as date and time, for the last-used and connected columns.
 * @param value - ISO timestamp, or null when the event never happened.
 * @param locale - The active UI locale.
 * @returns The date and time in `locale`, or "Never" when `value` is null.
 */
export function formatDate(value: string | null, locale: string): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * @description Formats a timestamp as a date alone, for the expiry badge.
 * @param value - ISO timestamp, or null when there is none.
 * @param locale - The active UI locale.
 * @returns The date in `locale`, or "" when `value` is null.
 */
export function formatDay(value: string | null, locale: string): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
