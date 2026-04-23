/**
 * @file AnalyticsRepository.basic.test.ts
 * @description Tests for AnalyticsRepository - Basic Operations
 * @layer infrastructure
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { PrismaAnalyticsReadRepository } from "../../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testChannelIds,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - Basic Operations", () => {
  it("AnalyticsRepository instantiates successfully", () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    expect(repo instanceof PrismaAnalyticsReadRepository).toBeTruthy();
  });
});

describe("AnalyticsRepository - getByPostIds", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns analytics for given post IDs with relationships", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!, testPostIds[1]!]);

    expect(Array.isArray(analytics)).toBeTruthy();
    expect(analytics.length > 0).toBeTruthy();

    analytics.forEach((record) => {
      expect(record.post !== undefined).toBeTruthy();
      expect(record.channel).toBeTruthy();
    });
  });

  it("respects startDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      startDate: twoDaysAgo,
    });

    analytics.forEach((record) => {
      expect(record.capturedAt >= twoDaysAgo).toBeTruthy();
    });
  });

  it("respects endDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      endDate: yesterday,
    });

    analytics.forEach((record) => {
      expect(record.capturedAt <= yesterday).toBeTruthy();
    });
  });

  it("respects provider filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, {
      provider: "X",
    });

    expect(analytics.length > 0).toBeTruthy();
    analytics.forEach((record) => {
      expect(record.provider).toBe("X");
    });
  });

  it("respects take option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, { take: 3 });

    expect(analytics.length).toBe(3);
  });

  it("respects skip option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const allAnalytics = await repo.getByPostIds(testPostIds);
    const skippedAnalytics = await repo.getByPostIds(testPostIds, { skip: 2 });

    expect(skippedAnalytics.length < allAnalytics.length).toBeTruthy();
  });

  it("orders by capturedAt desc by default", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds);

    for (let i = 0; i < analytics.length - 1; i++) {
      expect(analytics[i]!.capturedAt >= analytics[i + 1]!.capturedAt).toBeTruthy();
    }
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([]);

    expect(Array.isArray(analytics)).toBeTruthy();
    expect(analytics.length).toBe(0);
  });
});

describe("AnalyticsRepository - getByProjectId", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns all analytics for a project", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(projectId);

    expect(Array.isArray(analytics)).toBeTruthy();
    expect(analytics.length > 0).toBeTruthy();
    expect(analytics.length).toBe(10);
  });

  it("respects date range filters", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByProjectId(projectId, {
      startDate: threeDaysAgo,
      endDate: yesterday,
    });

    analytics.forEach((record) => {
      expect(record.capturedAt >= threeDaysAgo && record.capturedAt <= yesterday).toBeTruthy();
    });
  });

  it("respects provider filter", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(projectId, {
      provider: "INSTAGRAM",
    });

    expect(analytics.length > 0).toBeTruthy();
    analytics.forEach((record) => {
      expect(record.provider).toBe("INSTAGRAM");
    });
  });

  it("returns empty array for non-existent project", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId("non-existent-project");

    expect(analytics.length).toBe(0);
  });

  it("returns empty array for project with no posts", async () => {
    const { testAccountId } = await import("./AnalyticsRepository.test-helpers.js");
    const emptyProject = await prisma.project.create({
      data: {
        name: "Empty Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(emptyProject.id);

    expect(analytics.length).toBe(0);

    await prisma.project.delete({ where: { id: emptyProject.id } });
  });
});

describe("AnalyticsRepository - getByChannelId", () => {
  beforeAll(async () => {
    await setupTestData();
  });

  afterAll(async () => {
    await teardownTestData();
  });

  it("returns analytics for specific channel with post relationship", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId(testChannelIds[0]!);

    expect(Array.isArray(analytics)).toBeTruthy();
    expect(analytics.length > 0).toBeTruthy();

    analytics.forEach((record) => {
      expect(record.channelId).toBe(testChannelIds[0]);
      expect(record.post !== undefined).toBeTruthy();
    });
  });

  it("filters analytics by date range", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByChannelId(testChannelIds[0]!, {
      startDate: oneDayAgo,
    });

    analytics.forEach((record) => {
      expect(record.capturedAt >= oneDayAgo).toBeTruthy();
    });
  });

  it("returns empty array for non-existent channel", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId("non-existent-channel");

    expect(analytics.length).toBe(0);
  });
});
