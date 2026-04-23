/**
 * @file AnalyticsRepository.test-helpers.ts
 * @description Test helpers for analytics repository test helpers
 * @layer infrastructure
 */
import { prisma } from "@infra/prisma";

export let testAccountId: string;
export let testProjectId: string;
export let testChannelIds: string[] = [];
export let testPostIds: string[] = [];
export let testAnalyticsIds: string[] = [];

export async function setupTestData() {
  await teardownTestData();

  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const account = await prisma.account.create({
    data: {
      name: "Test Analytics Account",
      email: `test-analytics-${uniqueId}@example.com`,
      subscription: "PRO",
    },
  });
  testAccountId = account.id;

  const project = await prisma.project.create({
    data: {
      name: "Test Analytics Project",
      accountId: testAccountId,
    },
  });
  testProjectId = project.id;

  const channelX = await prisma.channel.create({
    data: {
      projectId: testProjectId,
      provider: "X",
      handle: "@test_x",
      credentials: { accessToken: "token_x" },
    },
  });
  testChannelIds.push(channelX.id);

  const channelInstagram = await prisma.channel.create({
    data: {
      projectId: testProjectId,
      provider: "INSTAGRAM",
      handle: "@test_instagram",
      credentials: { accessToken: "token_ig" },
    },
  });
  testChannelIds.push(channelInstagram.id);

  for (let i = 0; i < 5; i++) {
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "PUBLISHED",
        publishedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        contents: {
          create: {
            locale: "en",
            body: `Analytics test post ${i}`,
            revision: 1,
          },
        },
        media: {
          create: {
            url: `https://example.com/analytics-media${i}.jpg`,
            type: "image",
          },
        },
      },
    });
    testPostIds.push(post.id);

    const analytics1 = await prisma.analytics.create({
      data: {
        postId: post.id,
        channelId: i % 2 === 0 ? testChannelIds[0]! : testChannelIds[1]!,
        provider: i % 2 === 0 ? "X" : "INSTAGRAM",
        views: 1000 * (i + 1),
        likes: 100 * (i + 1),
        comments: 20 * (i + 1),
        shares: 10 * (i + 1),
        capturedAt: new Date(Date.now() - i * 60 * 60 * 1000),
      },
    });
    testAnalyticsIds.push(analytics1.id);

    const analytics2 = await prisma.analytics.create({
      data: {
        postId: post.id,
        channelId: i % 2 === 0 ? testChannelIds[0]! : testChannelIds[1]!,
        provider: i % 2 === 0 ? "X" : "INSTAGRAM",
        views: 500 * (i + 1),
        likes: 50 * (i + 1),
        comments: 10 * (i + 1),
        shares: 5 * (i + 1),
        capturedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - i * 60 * 60 * 1000),
      },
    });
    testAnalyticsIds.push(analytics2.id);
  }
}

export async function teardownTestData() {
  try {
    if (testAnalyticsIds.length > 0) {
      await prisma.analytics.deleteMany({ where: { id: { in: testAnalyticsIds } } });
      testAnalyticsIds = [];
    }

    if (testPostIds.length > 0) {
      await prisma.postMedia.deleteMany({ where: { postId: { in: testPostIds } } });
      await prisma.postContent.deleteMany({ where: { postId: { in: testPostIds } } });
      await prisma.post.deleteMany({ where: { id: { in: testPostIds } } });
      testPostIds = [];
    }

    if (testChannelIds.length > 0) {
      await prisma.channel.deleteMany({ where: { id: { in: testChannelIds } } });
      testChannelIds = [];
    }

    if (testProjectId) {
      await prisma.project.deleteMany({ where: { id: testProjectId } });
    }

    if (testAccountId) {
      await prisma.account.deleteMany({ where: { id: testAccountId } });
    }
  } catch {
    // Defensive cleanup: swallow errors to prevent test pollution
  }
}
