/**
 * @file value-objects.property.test.ts
 * @description Property suites for the domain value objects. Every identifier class accepts
 *   exactly the canonical UUID v4 strings and keeps them verbatim; ShortCode accepts exactly 3 to
 *   50 letters, digits and hyphens; email normalisation is idempotent; UTMParameters accepts
 *   exactly its URL-safe charset; ScheduledTime, under a fixed clock, accepts exactly the window
 *   from five minutes to one year ahead. Every run is pinned to one seed, so a failure replays as
 *   fast-check prints it (`fc.assert(property, { seed, path })`).
 * @layer infrastructure
 */

import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Result } from "@shared/types";
import { FIXED_CLOCK_ISO } from "@packages/vitest-shared/determinism";
import { ApprovalRequestId } from "@core/domain/value-objects/ApprovalRequestId.js";
import { CommentId } from "@core/domain/value-objects/CommentId.js";
import { CustomerUserId } from "@core/domain/value-objects/CustomerUserId.js";
import { normalizeEmail } from "@core/domain/value-objects/EmailAddress.js";
import {
  AccountId,
  CampaignId,
  ChannelId,
  ContentId,
  type EntityId,
  LinkClickId,
  MediaId,
  PostId,
  ProjectId,
  RecurringPostId,
  ScheduledReportId,
  TrackedLinkId,
} from "@core/domain/value-objects/EntityId.js";
import { MentionId } from "@core/domain/value-objects/MentionId.js";
import { NotificationId } from "@core/domain/value-objects/NotificationId.js";
import { ScheduledTime } from "@core/domain/value-objects/ScheduledTime.js";
import { ShortCode } from "@core/domain/value-objects/ShortCode.js";
import { SocialConversationId } from "@core/domain/value-objects/SocialConversationId.js";
import { SocialMessageId } from "@core/domain/value-objects/SocialMessageId.js";
import {
  UTMParameters,
  type UTMParametersProps,
} from "@core/domain/value-objects/UTMParameters.js";

/**
 * One fixed seed for every property of this file, so CI reproduces a failure byte for byte; 100
 * runs is fast-check's own default, and each run here costs microseconds.
 */
const PROPERTY_RUN = { seed: 20_261_018, numRuns: 100 } as const;

type IdParser = (candidate: string) => Result<EntityId, unknown>;

/** Every identifier value object that validates through `EntityId.isValidUUID`. */
const ID_PARSERS: ReadonlyArray<readonly [string, IdParser]> = [
  ["PostId", (id) => PostId.fromString(id)],
  ["ChannelId", (id) => ChannelId.fromString(id)],
  ["AccountId", (id) => AccountId.fromString(id)],
  ["ProjectId", (id) => ProjectId.fromString(id)],
  ["ContentId", (id) => ContentId.fromString(id)],
  ["MediaId", (id) => MediaId.fromString(id)],
  ["TrackedLinkId", (id) => TrackedLinkId.fromString(id)],
  ["LinkClickId", (id) => LinkClickId.fromString(id)],
  ["CampaignId", (id) => CampaignId.fromString(id)],
  ["ScheduledReportId", (id) => ScheduledReportId.fromString(id)],
  ["RecurringPostId", (id) => RecurringPostId.fromString(id)],
  ["ApprovalRequestId", (id) => ApprovalRequestId.fromString(id)],
  ["CommentId", (id) => CommentId.fromString(id)],
  ["CustomerUserId", (id) => CustomerUserId.fromString(id)],
  ["MentionId", (id) => MentionId.fromString(id)],
  ["NotificationId", (id) => NotificationId.fromString(id)],
  ["SocialConversationId", (id) => SocialConversationId.fromString(id)],
  ["SocialMessageId", (id) => SocialMessageId.fromString(id)],
];

const HEX_DIGITS = new Set("0123456789abcdefABCDEF");
const UUID_GROUP_LENGTHS = [8, 4, 4, 4, 12] as const;
const VERSION_NIBBLE_INDEX = 14;
const VARIANT_NIBBLE_INDEX = 19;

/**
 * The canonical v4 shape written without the production regex, so the oracle cannot inherit a
 * defect of the code it judges: five hex groups of 8-4-4-4-12, version nibble `4`, variant nibble
 * one of `8 9 a b` in either case.
 */
const isCanonicalUuidV4 = (candidate: string): boolean => {
  const groups = candidate.split("-");
  const shaped =
    groups.length === UUID_GROUP_LENGTHS.length &&
    groups.every(
      (group, index) =>
        group.length === UUID_GROUP_LENGTHS[index] && [...group].every((c) => HEX_DIGITS.has(c))
    );
  const variant = candidate.charAt(VARIANT_NIBBLE_INDEX);
  return (
    shaped && candidate.charAt(VERSION_NIBBLE_INDEX) === "4" && "89abAB".includes(variant || "-")
  );
};

const replaceAt = (text: string, index: number, replacement: string): string =>
  text.slice(0, index) + replacement + text.slice(index + 1);

const uuidV4 = fc.uuid({ version: 4 });

/** Strings around the boundary of the accepted set: near-misses of a valid UUID, plus noise. */
const uuidCandidate = fc.oneof(
  fc.mixedCase(uuidV4),
  fc
    .tuple(uuidV4, fc.constantFrom(..."012356789abcdef"))
    .map(([uuid, nibble]) => replaceAt(uuid, VERSION_NIBBLE_INDEX, nibble)),
  fc
    .tuple(uuidV4, fc.constantFrom(..."01234567cdefCDEF"))
    .map(([uuid, nibble]) => replaceAt(uuid, VARIANT_NIBBLE_INDEX, nibble)),
  fc
    .tuple(uuidV4, fc.nat({ max: 35 }), fc.string({ minLength: 1, maxLength: 1 }))
    .map(([uuid, index, character]) => replaceAt(uuid, index, character)),
  fc
    .tuple(uuidV4, fc.constantFrom(" ", "0", "-", "\n"), fc.boolean())
    .map(([uuid, extra, before]) => (before ? extra + uuid : uuid + extra)),
  fc.string()
);

describe("identifier value objects (property)", () => {
  it("accepts every UUID v4 in any letter case and returns it verbatim", () => {
    fc.assert(
      fc.property(fc.mixedCase(uuidV4), (candidate) => {
        for (const [name, parse] of ID_PARSERS) {
          const result = parse(candidate);
          assert.ok(result.ok, `${name} rejected ${candidate}`);
          assert.strictEqual(result.value.value, candidate, name);
        }
      }),
      PROPERTY_RUN
    );
  });

  it("accepts a string exactly when it is a canonical UUID v4", () => {
    fc.assert(
      fc.property(uuidCandidate, (candidate) => {
        const expected = isCanonicalUuidV4(candidate);
        for (const [name, parse] of ID_PARSERS) {
          assert.strictEqual(
            parse(candidate).ok,
            expected,
            `${name} on ${JSON.stringify(candidate)}`
          );
        }
      }),
      PROPERTY_RUN
    );
  });
});

const SHORT_CODE_CHARS = /^[a-zA-Z0-9-]+$/;
const validShortCode = fc.stringMatching(/^[a-zA-Z0-9-]{3,50}$/);

describe("ShortCode (property)", () => {
  it("accepts every 3 to 50 character code of letters, digits and hyphens verbatim", () => {
    fc.assert(
      fc.property(validShortCode, (code) => {
        const result = ShortCode.fromString(code);
        assert.ok(result.ok, code);
        assert.strictEqual(result.value.value, code);
      }),
      PROPERTY_RUN
    );
  });

  it("rejects a code of valid characters shorter than 3 or longer than 50", () => {
    const outOfRange = fc.oneof(
      fc.stringMatching(/^[a-zA-Z0-9-]{0,2}$/),
      fc.stringMatching(/^[a-zA-Z0-9-]{51,80}$/)
    );
    fc.assert(
      fc.property(outOfRange, (code) => {
        assert.ok(!ShortCode.fromString(code).ok, code);
      }),
      PROPERTY_RUN
    );
  });

  it("treats equality as reflexive, symmetric and decided by the value", () => {
    fc.assert(
      fc.property(validShortCode, validShortCode, (first, second) => {
        const a = ShortCode.fromStringUnsafe(first);
        const b = ShortCode.fromStringUnsafe(second);
        assert.ok(a.equals(a));
        assert.strictEqual(a.equals(b), b.equals(a));
        assert.strictEqual(a.equals(b), first === second);
      }),
      PROPERTY_RUN
    );
  });

  it("generates only codes that fromString accepts", () => {
    // `generate` draws from node:crypto, outside fast-check's seed, so this one samples directly.
    for (let draw = 0; draw < PROPERTY_RUN.numRuns; draw++) {
      const code = ShortCode.generate().value;
      assert.match(code, SHORT_CODE_CHARS);
      assert.ok(ShortCode.fromString(code).ok, code);
    }
  });
});

describe("normalizeEmail (property)", () => {
  it("is idempotent and returns a trimmed, lowercase form for any string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (address) => {
        const once = normalizeEmail(address);
        assert.strictEqual(normalizeEmail(once), once);
        assert.strictEqual(once, once.trim());
        assert.strictEqual(once, once.toLowerCase());
      }),
      PROPERTY_RUN
    );
  });
});

const URL_SAFE_CHARS = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
);
const isUrlSafe = (value: string): boolean =>
  value.length > 0 && [...value].every((c) => URL_SAFE_CHARS.has(c));
const utmValue = fc.oneof(fc.stringMatching(/^[A-Za-z0-9\-_.~]{1,30}$/), fc.string());

describe("UTMParameters (property)", () => {
  it("accepts the parameters exactly when every given value is URL-safe", () => {
    const props: fc.Arbitrary<UTMParametersProps> = fc.record(
      { source: utmValue, medium: utmValue, campaign: utmValue, content: utmValue, term: utmValue },
      { requiredKeys: ["source", "medium", "campaign"], noNullPrototype: true }
    );
    fc.assert(
      fc.property(props, (candidate) => {
        const result = UTMParameters.create(candidate);
        assert.strictEqual(result.ok, Object.values(candidate).every(isUrlSafe));
        if (result.ok) {
          assert.deepStrictEqual(result.value.toJSON(), candidate);
        }
      }),
      PROPERTY_RUN
    );
  });
});

const MIN_LEAD_MS = 5 * 60 * 1000;
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
const NOW_MS = new Date(FIXED_CLOCK_ISO).getTime();

const createAt = (offsetMs: number): ReturnType<typeof ScheduledTime.create> =>
  ScheduledTime.create({ dateTime: new Date(NOW_MS + offsetMs) });

describe("ScheduledTime under a fixed clock (property)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_CLOCK_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a date exactly when it lies five minutes to one year ahead", () => {
    const offset = fc.oneof(
      fc.integer({ min: -2 * MAX_HORIZON_MS, max: 2 * MAX_HORIZON_MS }),
      fc.integer({ min: -MIN_LEAD_MS, max: 2 * MIN_LEAD_MS }),
      fc.constantFrom(MIN_LEAD_MS - 1, MIN_LEAD_MS, MAX_HORIZON_MS, MAX_HORIZON_MS + 1)
    );
    fc.assert(
      fc.property(offset, (offsetMs) => {
        const result = createAt(offsetMs);
        assert.strictEqual(result.ok, offsetMs >= MIN_LEAD_MS && offsetMs <= MAX_HORIZON_MS);
        if (result.ok) {
          assert.strictEqual(result.value.timestamp, NOW_MS + offsetMs);
          assert.strictEqual(result.value.millisecondsUntil, offsetMs);
        }
      }),
      PROPERTY_RUN
    );
  });

  it("orders millisecondsUntil the same way as the dates", () => {
    const accepted = fc.integer({ min: MIN_LEAD_MS, max: MAX_HORIZON_MS });
    fc.assert(
      fc.property(accepted, accepted, (first, second) => {
        const [earlier, later] = first <= second ? [first, second] : [second, first];
        const a = createAt(earlier);
        const b = createAt(later);
        assert.ok(a.ok && b.ok);
        assert.ok(a.value.millisecondsUntil <= b.value.millisecondsUntil);
      }),
      PROPERTY_RUN
    );
  });
});
