/**
 * @file formatTemplateDate.ts
 * @description The date the template and automation cards show: abbreviated month, day and
 *   year in the active UI locale.
 * @layer infrastructure
 */

/**
 * @description Formats a timestamp as the cards' date: "Oct 29, 2026" in English, "29 oct 2026"
 *   in Spanish.
 * @param dateString - ISO timestamp.
 * @param locale - The active UI locale.
 * @returns The date in `locale`.
 */
export function formatTemplateDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
