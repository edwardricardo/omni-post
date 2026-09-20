/**
 * @file raiseRetractionAlert.test.ts
 * @description Unit tests for RaiseRetractionAlertUseCase — the consumer side of the
 *   urgent retraction alert. It pins the three things that are easy to get wrong and
 *   impossible to notice afterwards: that the per-member opt-out reaches BOTH
 *   per-member media, that the shared destination is governed by its config and NOT by
 *   anybody's preference, and that a redelivered event delivers NOTHING a second time.
 *   The idempotency assertions are NUMBERS, because an alert that arrives twice trains
 *   the customer to ignore the one alert that obliges a manual act.
 *
 *   There is deliberately NO per-medium preference scenario: the tree holds one
 *   enabled flag per (member, type), and inventing a per-medium answer for one type is
 *   a different change.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  RaiseRetractionAlertUseCase,
  type RaiseRetractionAlertInput,
} from "../../src/RaiseRetractionAlertUseCase.js";
import { buildRetractionAlertMessage } from "../../src/retractionAlertMessage.js";
import type { ResolveRetractionAlertUseCase } from "../../src/ResolveRetractionAlertUseCase.js";
import type {
  RetractionAlertDeliveryLedger,
  RetractionAlertDeliveryClaim,
} from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { NotificationPreferenceRepository } from "@core/domain/repositories/NotificationRepository.js";
import type {
  ExternalNotificationConfigRepository,
  ExternalNotificationConfigData,
} from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import {
  ALERT_MEDIA,
  ALERT_MEDIUM_KINDS,
  ALERT_DELIVERY_RESULTS,
  type AlertMedium,
  type AlertTarget,
  type RetractionAlertDelivery,
  type RetractionAlertView,
} from "@ports/core";
import { ok } from "@shared/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "p1000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const POST_ID = "b1000000-0000-4000-8000-000000000001";
const CHANNEL_ID = "c1000000-0000-4000-8000-000000000001";
// A readable synthetic key: the use case treats it as opaque, and a hex digest
// literal here reads as a leaked credential to the secret scanners.
const ALERT_KEY = "alert-key:post-b1000000:channel-c1000000:episode-1";
const MEMBER_ON = "m1000000-0000-4000-8000-000000000001";
const MEMBER_OFF = "m1000000-0000-4000-8000-000000000002";

/** A recording call log shared by every double, so ORDER is assertable. */
let callLog: string[] = [];

interface MemberFixture {
  id: string;
  email: string;
  typeEnabled: boolean;
}

const makeMembers = (): MemberFixture[] => [
  { id: MEMBER_ON, email: "on@example.test", typeEnabled: true },
  { id: MEMBER_OFF, email: "off@example.test", typeEnabled: false },
];

function makeCustomerUserRepo(members: MemberFixture[]): CustomerUserRepository {
  const asUsers = members.map((m) => ({
    id: m.id,
    email: m.email,
    firstName: "Test",
    lastName: "Member",
  }));
  return {
    findByProjectId: vi.fn(async () => asUsers),
    findByAccountId: vi.fn(async () => asUsers),
  } as unknown as CustomerUserRepository;
}

function makePreferenceRepo(members: MemberFixture[]): NotificationPreferenceRepository {
  return {
    findByMember: vi.fn(async (memberId: string) => {
      const member = members.find((m) => m.id === memberId);
      if (member === undefined || member.typeEnabled) return [];
      return [{ type: "PUBLICATION_RETRACTION_PENDING", enabled: false }];
    }),
  } as unknown as NotificationPreferenceRepository;
}

const makeConfig = (
  id: string,
  isActive: boolean,
  events: string[] = []
): ExternalNotificationConfigData =>
  ({
    id,
    accountId: ACCOUNT_ID,
    projectId: PROJECT_ID,
    channel: "slack",
    webhookUrl: "https://hooks.example.test/x",
    label: id,
    events,
    isActive,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  }) as ExternalNotificationConfigData;

function makeConfigRepo(
  configs: ExternalNotificationConfigData[],
  lookupError?: string
): ExternalNotificationConfigRepository {
  return {
    findByProjectId: vi.fn(async () =>
      lookupError === undefined
        ? ok(configs)
        : { ok: false as const, error: new Error(lookupError) }
    ),
  } as unknown as ExternalNotificationConfigRepository;
}

/** A ledger that really enforces the unique index, so two runs collide like the DB. */
function makeLedger(): RetractionAlertDeliveryLedger & { claimed: Set<string> } {
  const claimed = new Set<string>();
  const attached: string[] = [];
  return {
    claimed,
    claim: vi.fn(async (input: RetractionAlertDeliveryClaim) => {
      const key = `${input.alertKey}|${input.medium}|${input.target}`;
      callLog.push(`claim:${input.medium}:${input.target}`);
      if (claimed.has(key)) return { claimed: false };
      claimed.add(key);
      return { claimed: true };
    }),
    attachNotification: vi.fn(async (input: { target: string; notificationId: string }) => {
      attached.push(`${input.target}:${input.notificationId}`);
      callLog.push(`attach:${input.target}`);
    }),
    release: vi.fn(async (input: RetractionAlertDeliveryClaim) => {
      callLog.push(`release:${input.medium}:${input.target}`);
      claimed.delete(`${input.alertKey}|${input.medium}|${input.target}`);
    }),
    listByAlertKey: vi.fn(async () => []),
    deleteByAlertKey: vi.fn(async () => undefined),
  } as unknown as RetractionAlertDeliveryLedger & { claimed: Set<string> };
}

interface MediumDouble extends RetractionAlertDelivery {
  calls: AlertTarget[][];
}

/**
 * How a medium double answers. `throw` is the contract violation the port forbids and
 * the use case must survive anyway; `partial` is the shared fan-out reaching some of
 * its destinations and not others.
 */
type MediumBehaviour = "ok" | "fail" | "throw" | "partial" | "suppress";

/** Which target a `partial` double refuses — the second, so first and last succeed. */
const PARTIAL_FAILURE_INDEX = 1;

function makeMedium(
  medium: AlertMedium,
  kind: (typeof ALERT_MEDIUM_KINDS)[keyof typeof ALERT_MEDIUM_KINDS],
  behaviour: MediumBehaviour = "ok",
  notificationId?: string
): MediumDouble {
  const calls: AlertTarget[][] = [];
  return {
    medium,
    kind,
    calls,
    deliver: vi.fn(async (_alert: RetractionAlertView, targets: readonly AlertTarget[]) => {
      calls.push([...targets]);
      callLog.push(`deliver:${medium}:${targets.map((t) => t.id).join(",")}`);
      if (behaviour === "fail") {
        return { ok: false as const, error: `${medium} transport refused` };
      }
      if (behaviour === "throw") {
        throw new Error(`${medium} transport exploded`);
      }
      if (behaviour === "suppress") {
        return ok({
          suppressedTargets: targets.map((target) => ({
            targetId: target.id,
            reason: "the recipient's per-type preference is off",
          })),
        });
      }
      if (behaviour === "partial") {
        const refused = targets[PARTIAL_FAILURE_INDEX];
        return ok(
          refused === undefined
            ? {}
            : { failedTargets: [{ targetId: refused.id, reason: "destination unreachable" }] }
        );
      }
      return ok(notificationId === undefined ? {} : { notificationId });
    }),
  };
}

function makeResolver(): ResolveRetractionAlertUseCase {
  return {
    execute: vi.fn(async (input: { alertKey: string }) => {
      callLog.push(`resolve:${input.alertKey}`);
      return ok({ deletedNotifications: 0 });
    }),
  } as unknown as ResolveRetractionAlertUseCase;
}

const makeInput = (overrides?: Partial<RaiseRetractionAlertInput>): RaiseRetractionAlertInput => ({
  alertKey: ALERT_KEY,
  postId: POST_ID,
  projectId: PROJECT_ID,
  accountId: ACCOUNT_ID,
  accountName: "Acme Corp",
  channelId: CHANNEL_ID,
  channelName: "Acme on X",
  provider: "X",
  postExcerpt: "Launch week: three things we shipped",
  liveFragments: [
    { index: 1, externalId: "1811000000000000001", url: "https://x.test/acme/1" },
    { index: 2, externalId: "1811000000000000002" },
  ],
  cause: "NO_CAPABILITY",
  actionWindowEndsAt: "2026-09-22T09:00:00.000Z",
  ...overrides,
});

interface Harness {
  useCase: RaiseRetractionAlertUseCase;
  ledger: ReturnType<typeof makeLedger>;
  inApp: MediumDouble;
  email: MediumDouble;
  slack: MediumDouble;
  sms: MediumDouble;
  push: MediumDouble;
  resolver: ResolveRetractionAlertUseCase;
}

function makeHarness(options?: {
  members?: MemberFixture[];
  configs?: ExternalNotificationConfigData[];
  configsError?: string;
  failing?: AlertMedium;
  throwing?: AlertMedium;
  partial?: AlertMedium;
  suppressing?: AlertMedium;
  notificationId?: string;
}): Harness {
  const members = options?.members ?? makeMembers();
  const configs = options?.configs ?? [makeConfig("cfg-active", true)];
  const behaviourOf = (medium: AlertMedium): MediumBehaviour => {
    if (options?.throwing === medium) return "throw";
    if (options?.partial === medium) return "partial";
    if (options?.suppressing === medium) return "suppress";
    return options?.failing === medium ? "fail" : "ok";
  };
  const inApp = makeMedium(
    ALERT_MEDIA.IN_APP,
    ALERT_MEDIUM_KINDS.PER_MEMBER,
    behaviourOf(ALERT_MEDIA.IN_APP),
    options?.notificationId ?? "n1000000-0000-4000-8000-000000000001"
  );
  const email = makeMedium(
    ALERT_MEDIA.EMAIL,
    ALERT_MEDIUM_KINDS.PER_MEMBER,
    behaviourOf(ALERT_MEDIA.EMAIL)
  );
  const slack = makeMedium(
    ALERT_MEDIA.SLACK_TEAMS,
    ALERT_MEDIUM_KINDS.SHARED,
    behaviourOf(ALERT_MEDIA.SLACK_TEAMS)
  );
  const sms = makeMedium(ALERT_MEDIA.SMS, ALERT_MEDIUM_KINDS.PER_MEMBER);
  const push = makeMedium(ALERT_MEDIA.PUSH, ALERT_MEDIUM_KINDS.PER_MEMBER);
  const ledger = makeLedger();
  const resolver = makeResolver();
  // sms and push are NOT registered — a medium with no adapter in the tree is what
  // "unavailable" means, so registering a double for them would test the opposite.
  const useCase = new RaiseRetractionAlertUseCase(
    makeCustomerUserRepo(members),
    makePreferenceRepo(members),
    makeConfigRepo(configs, options?.configsError),
    ledger,
    [inApp, email, slack],
    resolver
  );
  return { useCase, ledger, inApp, email, slack, sms, push, resolver };
}

const resultsFor = (
  report: ReadonlyArray<{ medium: AlertMedium; target?: string; result: string }>,
  medium: AlertMedium
): string[] => report.filter((r) => r.medium === medium).map((r) => r.result);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RaiseRetractionAlertUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog = [];
  });

  describe("the per-member opt-out reaches BOTH per-member media", () => {
    it("delivers in-app AND email to a member with no preference row", async () => {
      const h = makeHarness();

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok, "the raise should succeed");
      assert.deepStrictEqual(h.inApp.calls, [[{ id: MEMBER_ON, email: "on@example.test" }]]);
      assert.deepStrictEqual(h.email.calls, [[{ id: MEMBER_ON, email: "on@example.test" }]]);
    });

    it("silences in-app AND email for a member whose type row is disabled", async () => {
      const h = makeHarness();

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const delivered = h.inApp.calls.flat().map((t) => t.id);
      assert.ok(!delivered.includes(MEMBER_OFF), "the opted-out member got an in-app alert");
      assert.ok(
        !h.email.calls.flat().some((t) => t.id === MEMBER_OFF),
        "the opted-out member got an email"
      );
      const inAppOff = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.IN_APP && r.target === MEMBER_OFF
      );
      const emailOff = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.EMAIL && r.target === MEMBER_OFF
      );
      assert.strictEqual(inAppOff?.result, ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE);
      assert.strictEqual(emailOff?.result, ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE);
    });
  });

  describe("the shared destination is governed by its config, never by a preference", () => {
    it("delivers to every ACTIVE config when NO member has the type enabled", async () => {
      const h = makeHarness({
        members: [{ id: MEMBER_OFF, email: "off@example.test", typeEnabled: false }],
        configs: [makeConfig("cfg-a", true), makeConfig("cfg-b", true)],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(
        h.slack.calls.flat().map((t) => t.id),
        ["cfg-a", "cfg-b"]
      );
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.SLACK_TEAMS), [
        ALERT_DELIVERY_RESULTS.DELIVERED,
        ALERT_DELIVERY_RESULTS.DELIVERED,
      ]);
    });

    it("delivers to the active config when the project has ZERO recipients", async () => {
      const h = makeHarness({ members: [], configs: [makeConfig("cfg-a", true)] });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.strictEqual(result.value.recipientCount, 0);
      assert.deepStrictEqual(
        h.slack.calls.flat().map((t) => t.id),
        ["cfg-a"]
      );
    });

    it("skips a DEACTIVATED config while its active sibling still receives the alert", async () => {
      const h = makeHarness({
        configs: [makeConfig("cfg-off", false), makeConfig("cfg-on", true)],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(
        h.slack.calls.flat().map((t) => t.id),
        ["cfg-on"]
      );
    });

    it("ignores the config's events filter — the filter predates this event type", async () => {
      const h = makeHarness({
        configs: [makeConfig("cfg-filtered", true, ["post.published", "post.failed"])],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(
        h.slack.calls.flat().map((t) => t.id),
        ["cfg-filtered"]
      );
    });
  });

  describe("the three not-delivered reasons are never collapsed", () => {
    it("reports no-active-config for a project with no active config, never a preference reason", async () => {
      const h = makeHarness({ configs: [makeConfig("cfg-off", false)] });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.SLACK_TEAMS), [
        ALERT_DELIVERY_RESULTS.NO_ACTIVE_CONFIG,
      ]);
    });

    it("reports sms and push as unavailable, never delivered, and claims nothing for them", async () => {
      const h = makeHarness();

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.SMS), [
        ALERT_DELIVERY_RESULTS.UNAVAILABLE,
      ]);
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.PUSH), [
        ALERT_DELIVERY_RESULTS.UNAVAILABLE,
      ]);
      assert.ok(
        !callLog.some((c) => c.startsWith(`claim:${ALERT_MEDIA.SMS}`)),
        "sms must not claim a ledger row"
      );
      assert.ok(
        !callLog.some((c) => c.startsWith(`claim:${ALERT_MEDIA.PUSH}`)),
        "push must not claim a ledger row"
      );
    });

    it("names the project and the store's own sentence when the config lookup fails", async () => {
      const h = makeHarness({ configsError: "the config store is unreachable" });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const shared = result.value.report.filter((r) => r.medium === ALERT_MEDIA.SLACK_TEAMS);
      assert.deepStrictEqual(
        shared.map((r) => r.result),
        [ALERT_DELIVERY_RESULTS.FAILED]
      );
      assert.strictEqual(
        shared[0]?.target,
        PROJECT_ID,
        "the failed line is about nobody, so whoever reads the warning cannot tell which project lost its shared destinations"
      );
      assert.match(
        shared[0]?.reason ?? "",
        /unreachable/,
        "the store said what went wrong and the report threw it away"
      );
    });

    it("names the project when the project has no active destination", async () => {
      const h = makeHarness({ configs: [makeConfig("cfg-off", false)] });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const shared = result.value.report.find((r) => r.medium === ALERT_MEDIA.SLACK_TEAMS);
      assert.strictEqual(shared?.result, ALERT_DELIVERY_RESULTS.NO_ACTIVE_CONFIG);
      assert.strictEqual(shared?.target, PROJECT_ID);
      assert.ok(
        (shared?.reason ?? "").length > 0,
        "the one line that could say why nothing shared went out says nothing"
      );
    });

    it("keeps all three reasons distinct in one report", async () => {
      const h = makeHarness({
        members: [{ id: MEMBER_OFF, email: "off@example.test", typeEnabled: false }],
        configs: [],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const present = new Set(result.value.report.map((r) => r.result));
      assert.ok(present.has(ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE));
      assert.ok(present.has(ALERT_DELIVERY_RESULTS.NO_ACTIVE_CONFIG));
      assert.ok(present.has(ALERT_DELIVERY_RESULTS.UNAVAILABLE));
      assert.strictEqual(present.has(ALERT_DELIVERY_RESULTS.DELIVERED), false);
    });
  });

  describe("idempotency is the ledger's, per medium and per target", () => {
    it("delivers ONE of each on the first run and NOTHING on the second", async () => {
      const h = makeHarness();

      const first = await h.useCase.execute(makeInput());
      const second = await h.useCase.execute(makeInput());

      assert.ok(first.ok && second.ok);
      assert.strictEqual(h.inApp.calls.flat().length, 1, "one in-app per enabled recipient");
      assert.strictEqual(h.email.calls.flat().length, 1, "one email per enabled recipient");
      assert.strictEqual(h.slack.calls.flat().length, 1, "one webhook per active config");
      // The second run delivers NOTHING — every claim collided. It still explains the
      // opted-out member, because a preference is not a claim and does not collide.
      assert.ok(
        !second.value.report.some((r) => r.result === ALERT_DELIVERY_RESULTS.DELIVERED),
        `the second run delivered something: ${JSON.stringify(second.value.report)}`
      );
      assert.deepStrictEqual(resultsFor(second.value.report, ALERT_MEDIA.IN_APP), [
        ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE,
      ]);
      assert.deepStrictEqual(resultsFor(second.value.report, ALERT_MEDIA.SLACK_TEAMS), []);
    });

    it("RELEASES the claim of a medium that failed, so a redelivery retries that member", async () => {
      const h = makeHarness({ failing: ALERT_MEDIA.EMAIL });

      const first = await h.useCase.execute(makeInput());
      const emailAfterFirst = h.email.calls.flat().length;
      const second = await h.useCase.execute(makeInput());

      assert.ok(first.ok && second.ok);
      assert.strictEqual(emailAfterFirst, 1, "the first run should have tried once");
      assert.strictEqual(
        h.email.calls.flat().length,
        2,
        "the failed member was never retried — the stale claim blocked the redelivery"
      );
      assert.ok(
        callLog.includes(`release:${ALERT_MEDIA.EMAIL}:${MEMBER_ON}`),
        `the failed claim was not released; log was ${callLog.join(" | ")}`
      );
    });

    it("NEVER releases a medium that delivered", async () => {
      const h = makeHarness({ failing: ALERT_MEDIA.EMAIL });

      await h.useCase.execute(makeInput());

      assert.ok(
        !callLog.some((c) => c.startsWith(`release:${ALERT_MEDIA.IN_APP}`)),
        "a delivered in-app alert was released and would be sent twice"
      );
      assert.ok(
        !callLog.some((c) => c.startsWith(`release:${ALERT_MEDIA.SLACK_TEAMS}`)),
        "a delivered webhook was released and would be sent twice"
      );
    });

    it("releases a shared destination's claims when the whole fan-out failed", async () => {
      const h = makeHarness({ failing: ALERT_MEDIA.SLACK_TEAMS });

      await h.useCase.execute(makeInput());

      assert.ok(callLog.includes(`release:${ALERT_MEDIA.SLACK_TEAMS}:cfg-active`));
    });
  });

  describe("a failure the medium did not report as err still releases its claim", () => {
    it("reports failed and releases the claim when a medium THROWS instead of returning err", async () => {
      const h = makeHarness({ throwing: ALERT_MEDIA.EMAIL });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok, "one medium breaking its contract must not fail the raise");
      const emailOn = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.EMAIL && r.target === MEMBER_ON
      );
      assert.strictEqual(
        emailOn?.result,
        ALERT_DELIVERY_RESULTS.FAILED,
        "a thrown transport was not reported as a failed delivery"
      );
      assert.ok(
        callLog.includes(`release:${ALERT_MEDIA.EMAIL}:${MEMBER_ON}`),
        `the thrown medium kept its claim, so the redelivery will never retry it; log was ${callLog.join(" | ")}`
      );
    });

    it("keeps delivering the REMAINING media after one of them threw", async () => {
      const h = makeHarness({ throwing: ALERT_MEDIA.IN_APP });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.deepStrictEqual(
        h.email.calls.flat().map((t) => t.id),
        [MEMBER_ON],
        "a throw on the first medium swallowed every medium after it"
      );
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.SLACK_TEAMS), [
        ALERT_DELIVERY_RESULTS.DELIVERED,
      ]);
    });

    it("CARRIES the medium's own reason onto the failed entry", async () => {
      const h = makeHarness({ throwing: ALERT_MEDIA.EMAIL });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const emailOn = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.EMAIL && r.target === MEMBER_ON
      );
      assert.match(
        emailOn?.reason ?? "",
        /exploded/,
        "the transport said why it failed and the report threw the sentence away"
      );
    });

    it("carries the reason of a shared destination that was not reached", async () => {
      const h = makeHarness({
        partial: ALERT_MEDIA.SLACK_TEAMS,
        configs: [makeConfig("cfg-a", true), makeConfig("cfg-b", true)],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const failed = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.SLACK_TEAMS && r.target === "cfg-b"
      );
      assert.match(failed?.reason ?? "", /unreachable/);
    });

    it("retries only the thrown medium's target on a redelivery", async () => {
      const h = makeHarness({ throwing: ALERT_MEDIA.EMAIL });

      await h.useCase.execute(makeInput());
      await h.useCase.execute(makeInput());

      assert.strictEqual(
        h.email.calls.flat().length,
        2,
        "the thrown member was never retried — the stale claim blocked the redelivery"
      );
      assert.strictEqual(
        h.inApp.calls.flat().length,
        1,
        "the delivered in-app alert was sent a second time"
      );
    });
  });

  describe("a target the medium DELIBERATELY did not send to is not a delivery", () => {
    it("reports a medium's own suppression as suppressed-by-preference, never delivered", async () => {
      const h = makeHarness({ suppressing: ALERT_MEDIA.IN_APP });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const inAppOn = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.IN_APP && r.target === MEMBER_ON
      );
      assert.strictEqual(
        inAppOn?.result,
        ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE,
        "a target nothing was sent to was counted as delivered"
      );
      assert.match(inAppOn?.reason ?? "", /preference/i);
    });

    it("releases the claim of a suppressed target", async () => {
      const h = makeHarness({ suppressing: ALERT_MEDIA.IN_APP });

      await h.useCase.execute(makeInput());

      assert.ok(
        callLog.includes(`release:${ALERT_MEDIA.IN_APP}:${MEMBER_ON}`),
        `a member who was not sent to kept a claim nothing owes, so re-enabling the preference could never reach them; log was ${callLog.join(" | ")}`
      );
    });

    it("lets a redelivery re-evaluate the preference instead of colliding with a stale claim", async () => {
      const h = makeHarness({ suppressing: ALERT_MEDIA.IN_APP });

      await h.useCase.execute(makeInput());
      await h.useCase.execute(makeInput());

      assert.strictEqual(
        h.inApp.calls.flat().length,
        2,
        "the second delivery never asked the medium again — a member who re-enabled the type stays unreachable forever"
      );
    });

    it("never attaches a notification id for a suppressed target", async () => {
      const h = makeHarness({ suppressing: ALERT_MEDIA.IN_APP });

      await h.useCase.execute(makeInput());

      assert.ok(!callLog.some((c) => c.startsWith("attach:")));
    });

    it("a member whose email preference is off is reported suppressed, not delivered, and the claim is released", async () => {
      const h = makeHarness({ suppressing: ALERT_MEDIA.EMAIL });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const emailOn = result.value.report.find(
        (r) => r.medium === ALERT_MEDIA.EMAIL && r.target === MEMBER_ON
      );
      assert.strictEqual(
        emailOn?.result,
        ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE,
        "an email nobody received was counted as delivered"
      );
      assert.ok(
        callLog.includes(`release:${ALERT_MEDIA.EMAIL}:${MEMBER_ON}`),
        `the unsent email kept its claim, so re-enabling the preference could never reach that member; log was ${callLog.join(" | ")}`
      );
    });
  });

  describe("a PARTIAL shared fan-out is per destination, never one verdict for all", () => {
    it("releases only the claims of the destinations the fan-out could not reach", async () => {
      const h = makeHarness({
        partial: ALERT_MEDIA.SLACK_TEAMS,
        configs: [makeConfig("cfg-a", true), makeConfig("cfg-b", true), makeConfig("cfg-c", true)],
      });

      await h.useCase.execute(makeInput());

      assert.ok(
        callLog.includes(`release:${ALERT_MEDIA.SLACK_TEAMS}:cfg-b`),
        `the unreached destination kept its claim and will never be retried; log was ${callLog.join(" | ")}`
      );
      assert.ok(
        !callLog.includes(`release:${ALERT_MEDIA.SLACK_TEAMS}:cfg-a`),
        "a destination that received the alert had its claim released and will be told twice"
      );
      assert.ok(!callLog.includes(`release:${ALERT_MEDIA.SLACK_TEAMS}:cfg-c`));
    });

    it("reports the unreached destination as failed while its siblings read delivered", async () => {
      const h = makeHarness({
        partial: ALERT_MEDIA.SLACK_TEAMS,
        configs: [makeConfig("cfg-a", true), makeConfig("cfg-b", true), makeConfig("cfg-c", true)],
      });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      const forTarget = (target: string): string | undefined =>
        result.value.report.find((r) => r.medium === ALERT_MEDIA.SLACK_TEAMS && r.target === target)
          ?.result;
      assert.strictEqual(forTarget("cfg-a"), ALERT_DELIVERY_RESULTS.DELIVERED);
      assert.strictEqual(
        forTarget("cfg-b"),
        ALERT_DELIVERY_RESULTS.FAILED,
        "a destination nobody reached was counted as delivered"
      );
      assert.strictEqual(forTarget("cfg-c"), ALERT_DELIVERY_RESULTS.DELIVERED);
    });

    it("HANDS the medium only the destinations this run claimed, so a redelivery names just the missed one", async () => {
      // What this level can guarantee is the ARGUMENT: the use case claims, then hands
      // the medium exactly what it claimed. That the medium then reaches those
      // destinations AND NO OTHERS is the shared adapter's own guarantee, pinned in
      // `SlackTeamsRetractionAlertDelivery.test.ts` ("fans out to exactly the CLAIMED
      // destinations") and in the dispatcher's ("reaches only the named configs").
      // Naming this one "retries ONLY the unreached destination" claimed the end-to-end
      // property while asserting against a double that could not break it.
      const h = makeHarness({
        partial: ALERT_MEDIA.SLACK_TEAMS,
        configs: [makeConfig("cfg-a", true), makeConfig("cfg-b", true), makeConfig("cfg-c", true)],
      });

      await h.useCase.execute(makeInput());
      await h.useCase.execute(makeInput());

      assert.deepStrictEqual(
        h.slack.calls.map((call) => call.map((t) => t.id)),
        [["cfg-a", "cfg-b", "cfg-c"], ["cfg-b"]],
        "the redelivery handed the medium more than the destination it had claimed"
      );
    });

    it("attaches the in-app notification id to the claimed ledger row", async () => {
      const h = makeHarness({ notificationId: "n9000000-0000-4000-8000-000000000009" });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.ok(callLog.includes(`attach:${MEMBER_ON}`), "the ledger row was never completed");
    });
  });

  describe("a superseded alert is resolved BEFORE the new key is claimed", () => {
    it("resolves the superseded key first", async () => {
      const h = makeHarness();

      const result = await h.useCase.execute(
        makeInput({ supersededAlertKey: "0000superseded0000" })
      );

      assert.ok(result.ok);
      const resolveAt = callLog.indexOf("resolve:0000superseded0000");
      const firstClaimAt = callLog.findIndex((c) => c.startsWith("claim:"));
      assert.ok(resolveAt >= 0, "the superseded key was never resolved");
      assert.ok(
        resolveAt < firstClaimAt,
        `resolve must precede the first claim; log was ${callLog.join(" | ")}`
      );
    });

    it("resolves nothing when no key was superseded", async () => {
      const h = makeHarness();

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.ok(!callLog.some((c) => c.startsWith("resolve:")));
    });
  });

  describe("one medium failing leaves the others standing", () => {
    it("marks only the failing medium failed and still delivers the rest", async () => {
      const h = makeHarness({ failing: ALERT_MEDIA.EMAIL });

      const result = await h.useCase.execute(makeInput());

      assert.ok(result.ok, "a transport failure must not fail the raise");
      const forTarget = (medium: AlertMedium, target: string): string | undefined =>
        result.value.report.find((r) => r.medium === medium && r.target === target)?.result;

      // The enabled member: email failed, in-app did not.
      assert.strictEqual(forTarget(ALERT_MEDIA.EMAIL, MEMBER_ON), ALERT_DELIVERY_RESULTS.FAILED);
      assert.strictEqual(
        forTarget(ALERT_MEDIA.IN_APP, MEMBER_ON),
        ALERT_DELIVERY_RESULTS.DELIVERED
      );
      assert.deepStrictEqual(resultsFor(result.value.report, ALERT_MEDIA.SLACK_TEAMS), [
        ALERT_DELIVERY_RESULTS.DELIVERED,
      ]);
      // The opted-out member is still reported as opted out on BOTH media — a
      // transport failure on one medium must not restate somebody else's preference.
      assert.strictEqual(
        forTarget(ALERT_MEDIA.EMAIL, MEMBER_OFF),
        ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE
      );
      assert.strictEqual(
        forTarget(ALERT_MEDIA.IN_APP, MEMBER_OFF),
        ALERT_DELIVERY_RESULTS.SUPPRESSED_BY_PREFERENCE
      );
    });
  });

  describe("recipient discovery falls back to the account", () => {
    it("uses the account's members when the project has none", async () => {
      const members = makeMembers();
      const repo = {
        findByProjectId: vi.fn(async () => []),
        findByAccountId: vi.fn(async () =>
          members.map((m) => ({ id: m.id, email: m.email, firstName: "T", lastName: "M" }))
        ),
      } as unknown as CustomerUserRepository;
      const useCase = new RaiseRetractionAlertUseCase(
        repo,
        makePreferenceRepo(members),
        makeConfigRepo([makeConfig("cfg-a", true)]),
        makeLedger(),
        [makeMedium(ALERT_MEDIA.IN_APP, ALERT_MEDIUM_KINDS.PER_MEMBER)],
        makeResolver()
      );

      const result = await useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.strictEqual(result.value.recipientCount, 2);
    });

    it("never widens beyond the project's own members while the project HAS members", async () => {
      const members = makeMembers();
      const repo = {
        findByProjectId: vi.fn(async () => [
          { id: MEMBER_ON, email: "on@example.test", firstName: "T", lastName: "M" },
        ]),
        findByAccountId: vi.fn(async () =>
          members.map((m) => ({ id: m.id, email: m.email, firstName: "T", lastName: "M" }))
        ),
      } as unknown as CustomerUserRepository;
      const inApp = makeMedium(ALERT_MEDIA.IN_APP, ALERT_MEDIUM_KINDS.PER_MEMBER);
      const useCase = new RaiseRetractionAlertUseCase(
        repo,
        makePreferenceRepo(members),
        makeConfigRepo([]),
        makeLedger(),
        [inApp],
        makeResolver()
      );

      const result = await useCase.execute(makeInput());

      assert.ok(result.ok);
      assert.strictEqual(result.value.recipientCount, 1);
      expect(repo.findByAccountId).not.toHaveBeenCalled();
      assert.deepStrictEqual(
        inApp.calls.flat().map((t) => t.id),
        [MEMBER_ON],
        "the account-wide set reached a member the project does not hold"
      );
    });

    it("keeps the account fallback inside the event's OWN account", async () => {
      const members = makeMembers();
      const repo = {
        findByProjectId: vi.fn(async () => []),
        findByAccountId: vi.fn(async () =>
          members.map((m) => ({ id: m.id, email: m.email, firstName: "T", lastName: "M" }))
        ),
      } as unknown as CustomerUserRepository;
      const useCase = new RaiseRetractionAlertUseCase(
        repo,
        makePreferenceRepo(members),
        makeConfigRepo([]),
        makeLedger(),
        [makeMedium(ALERT_MEDIA.IN_APP, ALERT_MEDIUM_KINDS.PER_MEMBER)],
        makeResolver()
      );

      await useCase.execute(makeInput());

      expect(repo.findByAccountId).toHaveBeenCalledWith(ACCOUNT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// The payload the customer reads
// ---------------------------------------------------------------------------

describe("buildRetractionAlertMessage", () => {
  it("names the channel, the post, every fragment, the cause, the action and the deadline", () => {
    const message = buildRetractionAlertMessage(makeInput());

    assert.match(message.title, /Acme on X/);
    assert.match(message.body, /Launch week: three things we shipped/);
    assert.match(message.body, /1811000000000000001/);
    assert.match(message.body, /1811000000000000002/);
    assert.match(message.body, /https:\/\/x\.test\/acme\/1/);
    assert.match(message.body, /no way to remove it/i);
    assert.match(message.body, /manually/i);
    assert.match(message.body, /2026-09-22/);
  });

  it("states the OTHER cause in the customer's vocabulary", () => {
    const message = buildRetractionAlertMessage(makeInput({ cause: "EXHAUSTED" }));

    assert.match(message.body, /attempted and failed/i);
    assert.ok(!/no way to remove it/i.test(message.body));
  });

  it("carries the identities in metadata and no credential-shaped field", () => {
    const message = buildRetractionAlertMessage(makeInput());

    assert.strictEqual(message.metadata.postId, POST_ID);
    assert.strictEqual(message.metadata.channelId, CHANNEL_ID);
    assert.strictEqual(message.metadata.alertKey, ALERT_KEY);
    assert.strictEqual(message.metadata.actionWindowEndsAt, "2026-09-22T09:00:00.000Z");
    const serialized = JSON.stringify(message);
    for (const forbidden of ["token", "secret", "credential", "password", "webhookUrl"]) {
      assert.ok(
        !serialized.toLowerCase().includes(forbidden),
        `the alert payload carries a ${forbidden}-shaped field`
      );
    }
  });

  it("omits the deadline sentence when no action window is open", () => {
    const message = buildRetractionAlertMessage(
      makeInput({ actionWindowEndsAt: undefined } as Partial<RaiseRetractionAlertInput>)
    );

    assert.ok(!/act by/i.test(message.body));
    assert.strictEqual(message.metadata.actionWindowEndsAt, undefined);
  });
});
