/**
 * @file isTypeEnabled.ts
 * @description The ONE predicate that answers "may this notification type reach this
 *   member?". The customer's answer is a single row per (member, type) and its
 *   ABSENCE means enabled, so the predicate has to distinguish "said no" from "never
 *   said anything" — a distinction that is easy to get backwards and was, until this
 *   function, written out separately by every caller that needed it.
 * @layer application
 */

import type { NotificationPreferenceDTO } from "@core/domain/repositories/NotificationRepository.js";
import type { NotificationTypeValue } from "@core/domain/value-objects/NotificationType.js";

/**
 * @function isTypeEnabled
 * @description Decides whether a member's preferences permit delivering the given
 *   notification type. A member with no row for the type is enabled: preferences are
 *   an opt-OUT, so a type nobody has answered for — including a type added after the
 *   member last touched their settings — still reaches them.
 * @param preferences - Every preference row held for one member
 * @param type - The notification type about to be delivered
 * @returns true when the type may be delivered, false when the member disabled it
 */
export function isTypeEnabled(
  preferences: readonly NotificationPreferenceDTO[],
  type: NotificationTypeValue
): boolean {
  const preference = preferences.find((candidate) => candidate.type === type);
  return preference === undefined || preference.enabled;
}
