/**
 * @file deletionMetrics.test.ts
 * @description Pins the deletion metrics, and above all the one distinction the
 *              overdue-plaintext gauge exists to make: an unanswered question
 *              must read as UNKNOWN, never as a clean zero.
 *
 *              That gauge is currently the only thing watching tombstones that
 *              hold plaintext PII past their own retention horizon — the
 *              two-phase design says a job should have degraded them to a keyed
 *              digest by then, and no such job exists yet. If a failed read
 *              reported 0, the dashboard would show "nothing overdue" for a
 *              level nobody measured, which is precisely the shape of green
 *              that this project treats as a defect rather than a passing test.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import client from "prom-client";

import {
  DELETION_RECORD_OVERDUE_UNKNOWN,
  recordHardDeleteImpact,
  setDeletionRecordOverdueProvider,
} from "../../../src/metrics/deletionMetrics.js";

const OVERDUE_GAUGE = "deletion_record_overdue_plaintext";

/** Scrapes the registry the way Prometheus does, so `collect` callbacks run. */
const scrapeOverdue = async (): Promise<number | undefined> => {
  const metric = client.register.getSingleMetric(OVERDUE_GAUGE) as client.Gauge | undefined;
  if (!metric) return undefined;
  const snapshot = await metric.get();
  return snapshot.values[0]?.value;
};

const histogramSum = async (name: string, entity: string): Promise<number | undefined> => {
  const metric = client.register.getSingleMetric(name) as client.Histogram | undefined;
  if (!metric) return undefined;
  const snapshot = await metric.get();
  return snapshot.values.find((v) => v.metricName === `${name}_sum` && v.labels.entity === entity)
    ?.value;
};

describe("deletion metrics", () => {
  beforeEach(() => {
    client.register.resetMetrics();
  });

  afterEach(() => {
    // The provider is module-level state; leaving one installed would leak a
    // test double into every later scrape in this process.
    setDeletionRecordOverdueProvider(undefined);
  });

  describe("overdue-plaintext gauge", () => {
    it("reports the measured level when the provider answers", async () => {
      setDeletionRecordOverdueProvider(async () => 42);
      expect(await scrapeOverdue()).toBe(42);
    });

    it("reports UNKNOWN, not zero, when the provider throws", async () => {
      // The whole point of the sentinel. A database that refuses the count is
      // an unanswered question; answering it with 0 would tell an operator
      // there is no overdue plaintext PII, which is a claim nobody made.
      setDeletionRecordOverdueProvider(async () => {
        throw new Error("database unavailable");
      });

      const value = await scrapeOverdue();
      expect(value).toBe(DELETION_RECORD_OVERDUE_UNKNOWN);
      expect(value).not.toBe(0);
    });

    it("reports UNKNOWN when the provider is removed", async () => {
      setDeletionRecordOverdueProvider(async () => 7);
      expect(await scrapeOverdue()).toBe(7);

      setDeletionRecordOverdueProvider(undefined);
      expect(await scrapeOverdue()).toBe(DELETION_RECORD_OVERDUE_UNKNOWN);
    });

    it("distinguishes a genuine zero from an unreadable level", async () => {
      // Zero is a legitimate, meaningful answer — nothing is overdue — and it
      // must stay distinguishable from the failure sentinel, or the gauge
      // cannot say the one thing it exists to say.
      setDeletionRecordOverdueProvider(async () => 0);
      expect(await scrapeOverdue()).toBe(0);

      setDeletionRecordOverdueProvider(async () => {
        throw new Error("unreadable");
      });
      expect(await scrapeOverdue()).toBe(DELETION_RECORD_OVERDUE_UNKNOWN);
    });

    it("keeps the sentinel outside the range a real count can occupy", () => {
      // A count is a cardinality: never negative. A sentinel inside the valid
      // range would be indistinguishable from a measurement.
      expect(DELETION_RECORD_OVERDUE_UNKNOWN).toBeLessThan(0);
    });
  });

  describe("hard-delete impact histograms", () => {
    it("records posts and child rows as separate series", async () => {
      // Two series rather than one summed value, because the dimensions have
      // different ceilings and fail independently: a tenant far under the post
      // limit can still be unremovable on child rows, and a sum would hide it.
      recordHardDeleteImpact("account", { posts: 1_500, childRows: 200_000 });

      expect(await histogramSum("hard_delete_impact_posts", "account")).toBe(1_500);
      expect(await histogramSum("hard_delete_impact_child_rows", "account")).toBe(200_000);
    });

    it("keeps account and project impact apart", async () => {
      recordHardDeleteImpact("account", { posts: 10, childRows: 100 });
      recordHardDeleteImpact("project", { posts: 3, childRows: 30 });

      expect(await histogramSum("hard_delete_impact_posts", "account")).toBe(10);
      expect(await histogramSum("hard_delete_impact_posts", "project")).toBe(3);
    });

    it("records an attempt the ceiling refuses, not only the ones that run", async () => {
      // The size guard observes BEFORE the transaction opens, so the
      // distribution shows a tenant approaching the wall instead of only the
      // day it hits it. A histogram fed solely by successful deletes would go
      // quiet exactly when the tenant became undeletable.
      recordHardDeleteImpact("account", { posts: 60_000, childRows: 5_000_000 });

      expect(await histogramSum("hard_delete_impact_posts", "account")).toBe(60_000);
    });
  });
});
