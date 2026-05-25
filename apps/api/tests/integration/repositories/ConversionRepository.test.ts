/**
 * @file ConversionRepository.test.ts
 * @description Integration tests for PrismaConversionRepository against a real
 *              PostgreSQL database. Exercises the actual INSERT (Decimal money,
 *              enum columns), the natural-key idempotency constraint (a
 *              re-report is a silent no-op), account-scoped SELECT with
 *              Decimal→number coercion, date-window and source filtering, and
 *              the FK cascade on account deletion.
 * @layer infrastructure
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { PrismaConversionRepository } from "../../../src/infrastructure/repositories/PrismaConversionRepository.js";
import type { ConversionRecordInput } from "@core/domain/repositories/ConversionRepository.js";

let accountId: string;
let otherAccountId: string;
const repo = new PrismaConversionRepository(prisma);

const baseInput = (overrides: Partial<ConversionRecordInput> = {}): ConversionRecordInput => ({
  accountId,
  source: "X",
  contentId: "post-1",
  conversionType: "SALE",
  value: 149.99,
  attribution: "LAST_CLICK",
  occurredAt: new Date("2026-05-10T12:00:00Z"),
  ...overrides,
});

const window = {
  start: new Date("2026-05-01T00:00:00Z"),
  end: new Date("2026-05-31T00:00:00Z"),
};

describe("PrismaConversionRepository (integration)", () => {
  before(async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const account = await prisma.account.create({
      data: { name: "Conv Test Account", email: `conv-${uniqueId}@example.com` },
    });
    accountId = account.id;
    const other = await prisma.account.create({
      data: { name: "Conv Other Account", email: `conv-other-${uniqueId}@example.com` },
    });
    otherAccountId = other.id;
  });

  after(async () => {
    // FK cascade removes conversions, but be explicit and defensive.
    await prisma.conversion.deleteMany({
      where: { accountId: { in: [accountId, otherAccountId] } },
    });
    await prisma.account.deleteMany({ where: { id: { in: [accountId, otherAccountId] } } });
  });

  beforeEach(async () => {
    await prisma.conversion.deleteMany({
      where: { accountId: { in: [accountId, otherAccountId] } },
    });
  });

  it("records a conversion and reads it back with the Decimal value coerced to a number", async () => {
    await repo.record(baseInput());
    const rows = await repo.findByAccount(accountId, window);
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0]?.value, "number");
    assert.equal(rows[0]?.value, 149.99);
    assert.equal(rows[0]?.source, "X");
    assert.equal(rows[0]?.conversionType, "SALE");
    assert.equal(rows[0]?.attribution, "LAST_CLICK");
  });

  it("is idempotent: a re-report of the same logical event creates no second row", async () => {
    await repo.record(baseInput({ value: 100 }));
    await repo.record(baseInput({ value: 999 })); // same natural key
    const rows = await repo.findByAccount(accountId, window);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.value, 100);
  });

  it("records distinct rows when occurredAt differs", async () => {
    await repo.record(baseInput({ occurredAt: new Date("2026-05-10T12:00:00Z") }));
    await repo.record(baseInput({ occurredAt: new Date("2026-05-10T12:00:01Z") }));
    const rows = await repo.findByAccount(accountId, window);
    assert.equal(rows.length, 2);
  });

  it("never returns another account's conversions (tenancy)", async () => {
    await repo.record(baseInput({ accountId }));
    await repo.record(baseInput({ accountId: otherAccountId, contentId: "post-other" }));
    const rows = await repo.findByAccount(otherAccountId, window);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.accountId, otherAccountId);
  });

  it("filters by date window and by source provider", async () => {
    await repo.record(
      baseInput({ source: "X", contentId: "p-x", occurredAt: new Date("2026-05-15T00:00:00Z") })
    );
    await repo.record(
      baseInput({
        source: "INSTAGRAM",
        contentId: "p-ig",
        occurredAt: new Date("2026-05-16T00:00:00Z"),
      })
    );
    await repo.record(
      baseInput({ source: "X", contentId: "p-old", occurredAt: new Date("2026-04-01T00:00:00Z") })
    );

    const inWindow = await repo.findByAccount(accountId, window);
    assert.equal(inWindow.length, 2);

    const onlyIg = await repo.findByAccount(accountId, { ...window, source: "INSTAGRAM" });
    assert.equal(onlyIg.length, 1);
    assert.equal(onlyIg[0]?.contentId, "p-ig");
  });

  it("cascades conversions when the owning account is deleted", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const temp = await prisma.account.create({
      data: { name: "Conv Temp", email: `conv-temp-${uniqueId}@example.com` },
    });
    await repo.record(baseInput({ accountId: temp.id }));
    await prisma.account.delete({ where: { id: temp.id } });
    const remaining = await prisma.conversion.count({ where: { accountId: temp.id } });
    assert.equal(remaining, 0);
  });
});
