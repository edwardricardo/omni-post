/**
 * @file isTypeEnabled.test.ts
 * @description Unit tests for the ONE per-type delivery predicate. The rule it holds
 *   is "absence means on": a member who never answered for a type still receives it,
 *   and only an explicit disabled row silences it. The predicate exists because the
 *   same rule was inlined in two places and a third caller was about to inline it a
 *   third time.
 * @layer infrastructure
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { isTypeEnabled } from "../../src/isTypeEnabled.js";
import type { NotificationPreferenceDTO } from "@core/domain/repositories/NotificationRepository.js";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePreference = (
  overrides?: Partial<NotificationPreferenceDTO>
): NotificationPreferenceDTO => ({
  type: NOTIFICATION_TYPES.MENTION,
  enabled: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isTypeEnabled", () => {
  let preferences: NotificationPreferenceDTO[];

  beforeEach(() => {
    preferences = [];
  });

  describe("no row for the type — the default is ON", () => {
    it("returns true when the member has answered for no type at all", () => {
      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.MENTION), true);
    });

    it("returns true when the member answered for OTHER types only", () => {
      preferences = [
        makePreference({ type: NOTIFICATION_TYPES.POST_APPROVED, enabled: false }),
        makePreference({ type: NOTIFICATION_TYPES.COMMENT_ADDED, enabled: false }),
      ];

      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.MENTION), true);
    });
  });

  describe("an explicit row decides", () => {
    it("returns false when the row for that exact type is disabled", () => {
      preferences = [makePreference({ type: NOTIFICATION_TYPES.MENTION, enabled: false })];

      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.MENTION), false);
    });

    it("returns true when the row for that exact type is enabled", () => {
      preferences = [makePreference({ type: NOTIFICATION_TYPES.MENTION, enabled: true })];

      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.MENTION), true);
    });

    it("silences only the type it names, leaving its siblings on", () => {
      preferences = [
        makePreference({ type: NOTIFICATION_TYPES.MENTION, enabled: false }),
        makePreference({ type: NOTIFICATION_TYPES.POST_APPROVED, enabled: true }),
      ];

      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.MENTION), false);
      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.POST_APPROVED), true);
      assert.strictEqual(isTypeEnabled(preferences, NOTIFICATION_TYPES.POST_REJECTED), true);
    });
  });

  describe("a type the preference store does not know", () => {
    it("returns true for a type no row names, so a newly added type is never silent by accident", () => {
      preferences = [makePreference({ type: NOTIFICATION_TYPES.MENTION, enabled: false })];

      assert.strictEqual(
        isTypeEnabled(preferences, NOTIFICATION_TYPES.INBOX_MENTION_RECEIVED),
        true
      );
    });
  });
});
