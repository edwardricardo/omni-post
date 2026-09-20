/**
 * @file readAlertFragments.ts
 * @description Reads the live-fragment list out of an UNTYPED payload — the outbox's
 *   reconstructed event on one side, a notification's stored metadata on the other.
 *
 *   It is one function because it was two, and two readers of one shape drift: the day
 *   one of them starts accepting a numeric `externalId`, the dashboard and the email
 *   name different fragments for the same stranded post, and the customer is left
 *   deciding which list to trust while content is live on a platform.
 *
 *   A malformed entry is DROPPED rather than fatal. The alert exists to say that content
 *   is still published; naming three of four fragments is worth sending, and a render
 *   that fails names none.
 * @layer application
 */

import type { AlertFragmentView } from "@ports/core";

const asUsableString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * @function readAlertFragments
 * @description Reads whatever survived transport into fragment references.
 * @param value - The payload's `liveFragments` field, whatever it turned out to be
 * @returns The entries that parse as fragment references, in the order they arrived
 */
export function readAlertFragments(value: unknown): AlertFragmentView[] {
  if (!Array.isArray(value)) return [];

  const fragments: AlertFragmentView[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const externalId = asUsableString(candidate.externalId);
    if (typeof candidate.index !== "number" || externalId === undefined) continue;
    const url = asUsableString(candidate.url);
    fragments.push({ index: candidate.index, externalId, ...(url !== undefined && { url }) });
  }
  return fragments;
}
