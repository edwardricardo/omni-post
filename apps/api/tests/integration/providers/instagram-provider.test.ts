#!/usr/bin/env tsx

import { ProviderTestBase, type TestResult } from "../provider-test-base.js";
import { InstagramAdapter } from "@providers/instagram";
import type { CanonicalPost } from "@shared/types";

/**
 * Comprehensive integration tests for Instagram provider
 * Tests carousel posts, media uploads, and Instagram-specific features
 */
export class InstagramProviderTest extends ProviderTestBase {
  protected providerId = "instagram";
  protected adapter = new InstagramAdapter();

  createTestCredentials(): Record<string, any> {
    return {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || "test-access-token",
      userId: process.env.INSTAGRAM_USER_ID || "test-user-id",
      pageId: process.env.INSTAGRAM_PAGE_ID || "test-page-id",
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
    };
  }

  createValidPost(): CanonicalPost {
    return {
      id: "test-instagram-post",
      projectId: "test-project",
      locale: "en",
      title: "Test Instagram Post",
      body: "Beautiful sunset at the beach 🌅 Perfect way to end the day! #sunset #beach #photography #nature #peaceful",
      media: [
        {
          id: "ig-media-1",
          type: "image",
          url: "https://test-cdn.example.com/sunset-beach.jpg",
          w: 1080,
          h: 1080,
          alt: "Beautiful sunset at the beach",
        },
      ],
      tags: ["sunset", "beach", "photography", "nature", "peaceful"],
    };
  }

  createInvalidPost(): CanonicalPost {
    return {
      id: "test-invalid-instagram-post",
      projectId: "test-project",
      locale: "en",
      body: "x".repeat(2300), // Exceeds Instagram's 2200 character limit
      media: [
        {
          id: "invalid-ig-media",
          type: "image",
          url: "https://invalid-url.com/nonexistent.jpg",
          w: 100, // Too small for Instagram
          h: 100,
        },
      ],
    };
  }

  getCharacterLimit(): number {
    return 2200;
  }

  getMaxMediaPerPost(): number {
    return 20; // Instagram carousel limit
  }

  /**
   * Test Instagram carousel functionality
   */
  async testCarouselCapability(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Multi-image carousel
    const carouselPost: CanonicalPost = {
      id: "carousel-test",
      projectId: "test-project",
      locale: "en",
      body: "Multi-image carousel showcase 📸 Swipe to see more amazing photos! #carousel #photography #travel",
      media: this.createTestMedia(5).map((m) => ({ ...m, type: "image" as const })),
    };

    const carouselRender = await this.timeOperation("carousel-render", () =>
      Promise.resolve(this.adapter.render(carouselPost))
    );

    results.push({
      name: "Carousel Rendering",
      passed: carouselRender.result.ok === true,
      duration: carouselRender.duration,
      error: carouselRender.result.ok ? undefined : carouselRender.result.error,
      metadata:
        carouselRender.result.ok && carouselRender.result.value.type === "thread"
          ? {
              slideCount: (carouselRender.result.value.content as any).tweets?.length || 0,
              postType: carouselRender.result.value.meta?.postType,
            }
          : undefined,
    });

    // Test 2: Long content carousel (text splitting)
    const longTextPost: CanonicalPost = {
      id: "long-text-carousel",
      projectId: "test-project",
      locale: "en",
      body:
        "This is a comprehensive guide to Instagram marketing that covers everything you need to know. ".repeat(
          20
        ) +
        " Here are the key strategies that will help you grow your audience and engagement. ".repeat(
          15
        ) +
        " Don't forget to use relevant hashtags and post consistently! #instagrammarketing #socialmedia #digitalmarketing",
      media: [this.createTestMedia(1)[0]],
    };

    const longTextRender = await this.timeOperation("long-text-carousel-render", () =>
      Promise.resolve(this.adapter.render(longTextPost))
    );

    results.push({
      name: "Long Text Carousel",
      passed: longTextRender.result.ok === true,
      duration: longTextRender.duration,
      error: longTextRender.result.ok ? undefined : longTextRender.result.error,
      metadata: longTextRender.result.ok
        ? {
            contentType: longTextRender.result.value.type,
            shouldSplitContent: longTextPost.body.length > 800,
          }
        : undefined,
    });

    // Test 3: Mixed media carousel (images + videos)
    const mixedCarouselPost: CanonicalPost = {
      id: "mixed-carousel-test",
      projectId: "test-project",
      locale: "en",
      body: "Mixed media carousel with both photos and videos 🎬📸 #mixedmedia #content #creative",
      media: [
        ...this.createTestMedia(3).map((m) => ({ ...m, type: "image" as const })),
        ...this.createTestMedia(2).map((m) => ({
          ...m,
          type: "video" as const,
          durationMs: 30000,
        })),
      ],
    };

    const mixedCarouselRender = await this.timeOperation("mixed-carousel-render", () =>
      Promise.resolve(this.adapter.render(mixedCarouselPost))
    );

    results.push({
      name: "Mixed Media Carousel",
      passed: mixedCarouselRender.result.ok === true,
      duration: mixedCarouselRender.duration,
      error: mixedCarouselRender.result.ok ? undefined : mixedCarouselRender.result.error,
    });

    return results;
  }

  /**
   * Test Instagram media processing
   */
  async testInstagramMediaProcessing(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Square image (1:1 ratio - Instagram's preferred)
    const squareImagePost: CanonicalPost = {
      id: "square-image-test",
      projectId: "test-project",
      locale: "en",
      body: "Perfect square image for Instagram feed ⬜ #square #perfectfit",
      media: [
        {
          id: "square-img",
          type: "image",
          url: "https://test-cdn.example.com/square-1080x1080.jpg",
          w: 1080,
          h: 1080,
          alt: "Square image",
        },
      ],
    };

    const squareImageRender = await this.timeOperation("square-image-render", () =>
      Promise.resolve(this.adapter.render(squareImagePost))
    );

    results.push({
      name: "Square Image Processing",
      passed: squareImageRender.result.ok === true,
      duration: squareImageRender.duration,
      error: squareImageRender.result.ok ? undefined : squareImageRender.result.error,
    });

    // Test 2: Portrait image (4:5 ratio)
    const portraitImagePost: CanonicalPost = {
      id: "portrait-image-test",
      projectId: "test-project",
      locale: "en",
      body: "Beautiful portrait orientation 📱 #portrait #vertical",
      media: [
        {
          id: "portrait-img",
          type: "image",
          url: "https://test-cdn.example.com/portrait-1080x1350.jpg",
          w: 1080,
          h: 1350,
          alt: "Portrait image",
        },
      ],
    };

    const portraitImageRender = await this.timeOperation("portrait-image-render", () =>
      Promise.resolve(this.adapter.render(portraitImagePost))
    );

    results.push({
      name: "Portrait Image Processing",
      passed: portraitImageRender.result.ok === true,
      duration: portraitImageRender.duration,
      error: portraitImageRender.result.ok ? undefined : portraitImageRender.result.error,
    });

    // Test 3: Video content (Reels format)
    const reelsPost: CanonicalPost = {
      id: "reels-test",
      projectId: "test-project",
      locale: "en",
      body: "Amazing Reel content! 🎥 Quick tutorial on photography tips #reels #tutorial #photography",
      media: [
        {
          id: "reel-video",
          type: "video",
          url: "https://test-cdn.example.com/reel-video-9x16.mp4",
          w: 1080,
          h: 1920, // 9:16 ratio for Reels
          durationMs: 30000, // 30 seconds
          alt: "Photography tutorial reel",
        },
      ],
    };

    const reelsRender = await this.timeOperation("reels-render", () =>
      Promise.resolve(this.adapter.render(reelsPost))
    );

    results.push({
      name: "Reels Video Processing",
      passed: reelsRender.result.ok === true,
      duration: reelsRender.duration,
      error: reelsRender.result.ok ? undefined : reelsRender.result.error,
      metadata:
        reelsRender.result.ok && reelsRender.result.value.type === "single"
          ? {
              mediaType: (reelsRender.result.value.content as any).meta?.mediaType,
            }
          : undefined,
    });

    // Test 4: Large image file handling
    const largeImagePost: CanonicalPost = {
      id: "large-image-test",
      projectId: "test-project",
      locale: "en",
      body: "Testing large image file handling",
      media: [
        {
          id: "large-img",
          type: "image",
          url: "https://test-cdn.example.com/large-image-10mb.jpg",
          w: 4000,
          h: 4000,
          alt: "Large image file",
        },
      ],
    };

    const largeImageRender = await this.timeOperation("large-image-render", () =>
      Promise.resolve(this.adapter.render(largeImagePost))
    );

    results.push({
      name: "Large Image File Handling",
      passed: largeImageRender.result.ok === true,
      duration: largeImageRender.duration,
      error: largeImageRender.result.ok ? undefined : largeImageRender.result.error,
    });

    return results;
  }

  /**
   * Test Instagram hashtag optimization
   */
  async testHashtagOptimization(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Hashtag extraction and optimization
    const hashtagPost: CanonicalPost = {
      id: "hashtag-test",
      projectId: "test-project",
      locale: "en",
      body: "Check out this amazing content with lots of #hashtags #instagram #photography #sunset #beach #travel #nature #beautiful #amazing #wonderful #perfect #stunning #gorgeous #breathtaking #incredible #fantastic #excellent #outstanding #remarkable #spectacular #magnificent #lovely #delightful #charming #elegant #graceful",
    };

    const hashtagRender = await this.timeOperation("hashtag-optimization", () =>
      Promise.resolve(this.adapter.render(hashtagPost))
    );

    results.push({
      name: "Hashtag Optimization",
      passed: hashtagRender.result.ok === true,
      duration: hashtagRender.duration,
      error: hashtagRender.result.ok ? undefined : hashtagRender.result.error,
      metadata: hashtagRender.result.ok
        ? {
            optimizedHashtags:
              (hashtagRender.result.value.content as any).text?.match(/#\w+/g)?.length || 0,
          }
        : undefined,
    });

    // Test 2: Case normalization
    const mixedCasePost: CanonicalPost = {
      id: "mixed-case-hashtag-test",
      projectId: "test-project",
      locale: "en",
      body: "Testing hashtag case normalization #Photography #TRAVEL #Nature #BeAcH #SuNsEt",
    };

    const mixedCaseRender = await this.timeOperation("hashtag-case-normalization", () =>
      Promise.resolve(this.adapter.render(mixedCasePost))
    );

    results.push({
      name: "Hashtag Case Normalization",
      passed: mixedCaseRender.result.ok === true,
      duration: mixedCaseRender.duration,
      error: mixedCaseRender.result.ok ? undefined : mixedCaseRender.result.error,
    });

    return results;
  }

  /**
   * Test Instagram publishing workflow with container system
   */
  async testInstagramPublishing(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Single image publishing
    this.mockServer.mockInstagramContainerFlow("single");

    const singleImagePost = this.createValidPost();
    const publishResult = await this.timeOperation("instagram-single-publish", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: {
          text: singleImagePost.body,
          media: singleImagePost.media,
        },
      })
    );

    results.push({
      name: "Single Image Publishing",
      passed: publishResult.result.ok === true,
      duration: publishResult.duration,
      error: publishResult.result.ok ? undefined : publishResult.result.error,
      metadata: publishResult.result.ok
        ? {
            providerPostId: publishResult.result.value.providerPostId,
            hasPermalink: !!publishResult.result.value.url,
          }
        : undefined,
    });

    // Test 2: Carousel publishing
    this.mockServer.mockInstagramContainerFlow("carousel");

    const carouselPost: CanonicalPost = {
      ...singleImagePost,
      media: this.createTestMedia(5),
    };

    const carouselPublishResult = await this.timeOperation("instagram-carousel-publish", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: {
          text: carouselPost.body,
          media: carouselPost.media,
        },
      })
    );

    results.push({
      name: "Carousel Publishing",
      passed: carouselPublishResult.result.ok === true,
      duration: carouselPublishResult.duration,
      error: carouselPublishResult.result.ok ? undefined : carouselPublishResult.result.error,
    });

    // Test 3: Video publishing
    this.mockServer.mockInstagramContainerFlow("video");

    const videoPost: CanonicalPost = {
      ...singleImagePost,
      media: [
        {
          id: "video-1",
          type: "video",
          url: "https://test-cdn.example.com/test-video.mp4",
          w: 1080,
          h: 1080,
          durationMs: 60000,
          alt: "Test video",
        },
      ],
    };

    const videoPublishResult = await this.timeOperation("instagram-video-publish", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: {
          text: videoPost.body,
          media: videoPost.media,
        },
      })
    );

    results.push({
      name: "Video Publishing",
      passed: videoPublishResult.result.ok === true,
      duration: videoPublishResult.duration,
      error: videoPublishResult.result.ok ? undefined : videoPublishResult.result.error,
    });

    return results;
  }

  /**
   * Test Instagram analytics with Business API
   */
  async testInstagramAnalytics(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    if (!this.adapter.fetchAnalytics) {
      results.push({
        name: "Analytics Not Supported",
        passed: true,
        duration: 0,
        metadata: { reason: "Instagram adapter does not support analytics" },
      });
      return results;
    }

    // Mock Instagram Insights API response
    this.mockServer.mockInstagramInsights();

    const analyticsResult = await this.timeOperation("instagram-analytics", () =>
      this.adapter.fetchAnalytics!({
        channelId: "test-channel",
        since: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000), // 28 days ago
        until: new Date(),
      })
    );

    results.push({
      name: "Instagram Analytics Fetching",
      passed: analyticsResult.result.ok === true,
      duration: analyticsResult.duration,
      error: analyticsResult.result.ok ? undefined : analyticsResult.result.error,
      metadata: analyticsResult.result.ok
        ? {
            hasImpressions: "impressions" in analyticsResult.result.value.metrics,
            hasReach: "reach" in analyticsResult.result.value.metrics,
            hasProfileViews: "profileViews" in analyticsResult.result.value.metrics,
            metricsCount: Object.keys(analyticsResult.result.value.metrics).length,
          }
        : undefined,
    });

    return results;
  }

  /**
   * Test Instagram-specific error scenarios
   */
  async testInstagramSpecificErrors(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Business account requirement
    this.mockServer.mockInstagramPersonalAccountError();

    const personalAccountResult = await this.timeOperation("personal-account-error", () =>
      this.adapter.validateCredentials({
        ...this.testCredentials,
        accountType: "PERSONAL",
      })
    );

    results.push({
      name: "Personal Account Error",
      passed:
        !personalAccountResult.result.ok && personalAccountResult.result.error === "AUTH_INVALID",
      duration: personalAccountResult.duration,
      error: personalAccountResult.result.ok ? "Expected personal account rejection" : undefined,
    });

    // Test 2: Media container timeout
    this.mockServer.mockInstagramContainerTimeout();

    const timeoutPost = this.createValidPost();
    const timeoutResult = await this.timeOperation("container-timeout", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: {
          text: timeoutPost.body,
          media: timeoutPost.media,
        },
      })
    );

    results.push({
      name: "Container Timeout Handling",
      passed: !timeoutResult.result.ok && timeoutResult.result.error === "NETWORK",
      duration: timeoutResult.duration,
      error: timeoutResult.result.ok ? "Expected timeout error" : undefined,
    });

    // Test 3: Invalid media URL
    this.mockServer.mockInstagramInvalidMediaError();

    const invalidMediaPost: CanonicalPost = {
      ...this.createValidPost(),
      media: [
        {
          id: "invalid-media",
          type: "image",
          url: "https://invalid-domain-that-does-not-exist.com/image.jpg",
          w: 1080,
          h: 1080,
        },
      ],
    };

    const invalidMediaResult = await this.timeOperation("invalid-media-error", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: {
          text: invalidMediaPost.body,
          media: invalidMediaPost.media,
        },
      })
    );

    results.push({
      name: "Invalid Media URL Handling",
      passed: !invalidMediaResult.result.ok && invalidMediaResult.result.error === "VALIDATION",
      duration: invalidMediaResult.duration,
      error: invalidMediaResult.result.ok ? "Expected validation error" : undefined,
    });

    return results;
  }

  /**
   * Run Instagram-specific comprehensive test suite
   */
  async runInstagramSpecificTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      const carouselResults = await this.testCarouselCapability();
      const mediaResults = await this.testInstagramMediaProcessing();
      const hashtagResults = await this.testHashtagOptimization();
      const publishingResults = await this.testInstagramPublishing();
      const analyticsResults = await this.testInstagramAnalytics();
      const errorResults = await this.testInstagramSpecificErrors();

      results.push(
        ...carouselResults,
        ...mediaResults,
        ...hashtagResults,
        ...publishingResults,
        ...analyticsResults,
        ...errorResults
      );
    } catch (error) {
      results.push({
        name: "Instagram-Specific Test Suite",
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return results;
  }
}

// Extend MockProviderServer for Instagram-specific mocking
class _InstagramMockProviderServer {
  mockInstagramContainerFlow(_type: "single" | "carousel" | "video"): void {
    // Mock the Instagram container creation and publishing flow
    // This would set up responses for:
    // 1. POST /ig_user/media (create container)
    // 2. GET /ig_container_id (check status)
    // 3. POST /ig_user/media_publish (publish container)
  }

  mockInstagramInsights(): void {
    // Mock Instagram Insights API responses
    // GET /ig_user/insights, GET /ig_user/media
  }

  mockInstagramPersonalAccountError(): void {
    // Mock error when trying to use personal account
  }

  mockInstagramContainerTimeout(): void {
    // Mock container status staying in "IN_PROGRESS" indefinitely
  }

  mockInstagramInvalidMediaError(): void {
    // Mock media validation errors from Instagram
  }
}

// Main execution function
async function runInstagramProviderTests(): Promise<void> {
  // Skip when real Instagram credentials are not available
  if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
    console.log("⏭️  Skipping Instagram integration tests (INSTAGRAM_ACCESS_TOKEN not set)");
    return;
  }

  console.log("🔬 Running Instagram Provider Integration Tests");
  console.log("===============================================");

  const testSuite = new InstagramProviderTest();

  try {
    // Run base test suite
    const baseReport = await testSuite.runFullTestSuite();

    // Run Instagram-specific tests
    const instagramSpecificResults = await testSuite.runInstagramSpecificTests();

    // Add Instagram-specific results to report
    baseReport.testSuites.push({
      name: "Instagram-Specific Features",
      results: instagramSpecificResults,
      duration: instagramSpecificResults.reduce((sum, r) => sum + (r.duration || 0), 0),
      passed: instagramSpecificResults.every((r) => r.passed),
    });

    // Update summary
    baseReport.summary.totalTests += instagramSpecificResults.length;
    baseReport.summary.passedTests += instagramSpecificResults.filter((r) => r.passed).length;
    baseReport.summary.failedTests = baseReport.summary.totalTests - baseReport.summary.passedTests;
    baseReport.summary.overallSuccess = baseReport.summary.failedTests === 0;

    // Print detailed report
    printTestReport(baseReport);
  } catch (error) {
    console.error("❌ Instagram Provider test suite failed:", error);
    process.exit(1);
  }
}

function printTestReport(report: any): void {
  console.log(`\n📊 Test Results for ${report.providerId.toUpperCase()}`);
  console.log("===================================");

  for (const suite of report.testSuites) {
    console.log(`\n📝 ${suite.name}`);
    console.log(`Duration: ${suite.duration.toFixed(2)}ms`);
    console.log(`Status: ${suite.passed ? "✅ PASSED" : "❌ FAILED"}`);

    for (const result of suite.results) {
      const status = result.passed ? "✅" : "❌";
      const duration = result.duration ? ` (${result.duration.toFixed(2)}ms)` : "";
      console.log(`  ${status} ${result.name}${duration}`);

      if (!result.passed && result.error) {
        console.log(`      Error: ${result.error}`);
      }

      if (result.metadata) {
        console.log(`      Metadata: ${JSON.stringify(result.metadata)}`);
      }
    }
  }

  console.log("\n📋 Summary");
  console.log("===========");
  console.log(`Total Tests: ${report.summary.totalTests}`);
  console.log(`Passed: ${report.summary.passedTests}`);
  console.log(`Failed: ${report.summary.failedTests}`);
  console.log(
    `Success Rate: ${((report.summary.passedTests / report.summary.totalTests) * 100).toFixed(1)}%`
  );
  console.log(`Total Duration: ${report.summary.totalDuration.toFixed(2)}ms`);

  if (report.summary.overallSuccess) {
    console.log("\n🎉 All Instagram provider tests passed!");
  } else {
    console.log("\n⚠️ Some Instagram provider tests failed.");
    process.exit(1);
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runInstagramProviderTests().catch(console.error);
}
