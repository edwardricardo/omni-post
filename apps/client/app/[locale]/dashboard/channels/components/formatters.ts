/**
 * @file formatters.ts
 * @description Date helpers shared across the channels page sub-components.
 *              `formatDate` is the long form ("MMM d, yyyy hh:mm"); `formatDay`
 *              is the short form used inside the "Expired on …" badge.
 * @layer infrastructure
 */

export function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
