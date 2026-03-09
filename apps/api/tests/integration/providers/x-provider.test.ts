#!/usr/bin/env tsx

import { ProviderTestBase, type TestResult } from "../provider-test-base.js";
import { XAdapter } from "@providers/x";
import type { CanonicalPost } from "@shared/types";

/**
 * Comprehensive integration tests for X (Twitter) provider
 * Tests threading, media handling, and X-specific features
 */
export class XProviderTest extends ProviderTestBase {
  protected providerId = "x";
  protected adapter = new XAdapter();

  createTestCredentials(): Record<string, any> {
    return {
      apiKey: process.env.X_API_KEY || "test-api-key",
      apiSecret: process.env.X_API_SECRET || "test-api-secret",
      accessToken: process.env.X_ACCESS_TOKEN || "test-access-token",
      accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || "test-access-token-secret",
      bearerToken: process.env.X_BEARER_TOKEN || "test-bearer-token",
    };
  }

  createValidPost(): CanonicalPost {
    return {
      id: "test-post-123",
      projectId: "test-project",
      locale: "en",
      title: "Test X Post",
      body: "This is a test post for X/Twitter platform integration testing. #test #integration",
      media: [
        {
          id: "media-1",
          type: "image",
          url: "https://test-cdn.example.com/test-image.jpg",
          w: 1200,
          h: 675,
          alt: "Test image for X post",
        },
      ],
      tags: ["test", "integration", "x", "twitter"],
    };
  }

  createInvalidPost(): CanonicalPost {
    return {
      id: "test-invalid-post",
      projectId: "test-project",
      locale: "en",
      body: "", // Empty content should be invalid
      media: [
        {
          id: "invalid-media",
          type: "image",
          url: "https://invalid-url.com/nonexistent.jpg",
          w: 50000, // Exceeds Twitter's dimension limits
          h: 50000,
        },
      ],
    };
  }

  getCharacterLimit(): number {
    return 280;
  }

  getMaxMediaPerPost(): number {
    return 4;
  }

  /**
   * Test X-specific threading functionality
   */
  async testThreadingCapability(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Thread planning for long content
    const longContent =
      "This is a very long thread that will definitely exceed the 280 character limit for a single tweet and should be automatically split into multiple tweets. ".repeat(
        5
      );

    const threadPost: CanonicalPost = {
      id: "thread-test",
      projectId: "test-project",
      locale: "en",
      body: longContent,
    };

    const threadPlanResult = await this.timeOperation("thread-planning", () =>
      Promise.resolve(this.adapter.planThread(threadPost))
    );

    results.push({
      name: "Thread Planning",
      passed: threadPlanResult.result.ok === true,
      duration: threadPlanResult.duration,
      error: threadPlanResult.result.ok ? undefined : threadPlanResult.result.error,
      metadata: threadPlanResult.result.ok
        ? {
            tweetCount: threadPlanResult.result.value.tweets.length,
            totalChars: threadPlanResult.result.value.totalChars,
            needsThreading: threadPlanResult.result.value.needsThreading,
          }
        : undefined,
    });

    // Test 2: Thread publishing workflow
    if (threadPlanResult.result.ok && this.adapter.publishThread) {
      this.mockServer.mockSuccess("publish");

      const threadPublishResult = await this.timeOperation("thread-publishing", () =>
        this.adapter.publishThread!({
          channelId: "test-channel",
          threadPlan: threadPlanResult.result.value,
          dedupeKey: "test-thread-123",
        })
      );

      results.push({
        name: "Thread Publishing",
        passed: threadPublishResult.result.ok === true,
        duration: threadPublishResult.duration,
        error: threadPublishResult.result.ok ? undefined : threadPublishResult.result.error,
        metadata: threadPublishResult.result.ok
          ? {
              publishedTweets: threadPublishResult.result.value.totalTweets,
              threadId: threadPublishResult.result.value.threadId,
            }
          : undefined,
      });
    }

    // Test 3: Thread with media distribution
    const mediaThreadPost: CanonicalPost = {
      id: "media-thread-test",
      projectId: "test-project",
      locale: "en",
      body: longContent,
      media: this.createTestMedia(6), // More media than fits in one tweet
    };

    const mediaThreadPlan = await this.timeOperation("media-thread-planning", () =>
      Promise.resolve(this.adapter.planThread(mediaThreadPost))
    );

    results.push({
      name: "Media Thread Planning",
      passed: mediaThreadPlan.result.ok === true,
      duration: mediaThreadPlan.duration,
      error: mediaThreadPlan.result.ok ? undefined : mediaThreadPlan.result.error,
      metadata: mediaThreadPlan.result.ok
        ? {
            distributedMedia: mediaThreadPlan.result.value.tweets.some(
              (t) => t.media && t.media.length > 0
            ),
          }
        : undefined,
    });

    return results;
  }

  /**
   * Test X-specific media handling
   */
  async testXMediaHandling(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Multiple images (up to 4)
    const multiImagePost: CanonicalPost = {
      id: "multi-image-test",
      projectId: "test-project",
      locale: "en",
      body: "Testing multiple images on X",
      media: this.createTestMedia(4).map((m) => ({ ...m, type: "image" as const })),
    };

    const multiImageRender = await this.timeOperation("multi-image-render", () =>
      Promise.resolve(this.adapter.render(multiImagePost))
    );

    results.push({
      name: "Multiple Images Rendering",
      passed: multiImageRender.result.ok === true,
      duration: multiImageRender.duration,
      error: multiImageRender.result.ok ? undefined : multiImageRender.result.error,
    });

    // Test 2: Video + images (should handle mixed media)
    const mixedMediaPost: CanonicalPost = {
      id: "mixed-media-test",
      projectId: "test-project",
      locale: "en",
      body: "Testing mixed media on X",
      media: [
        ...this.createTestMedia(1).map((m) => ({ ...m, type: "video" as const })),
        ...this.createTestMedia(2).map((m) => ({ ...m, type: "image" as const })),
      ],
    };

    const mixedMediaRender = await this.timeOperation("mixed-media-render", () =>
      Promise.resolve(this.adapter.render(mixedMediaPost))
    );

    results.push({
      name: "Mixed Media Handling",
      passed: mixedMediaRender.result.ok === true,
      duration: mixedMediaRender.duration,
      error: mixedMediaRender.result.ok ? undefined : mixedMediaRender.result.error,
    });

    // Test 3: GIF handling
    const gifPost: CanonicalPost = {
      id: "gif-test",
      projectId: "test-project",
      locale: "en",
      body: "Testing GIF on X",
      media: [
        {
          id: "gif-1",
          type: "gif",
          url: "https://test-cdn.example.com/test.gif",
          w: 480,
          h: 270,
          alt: "Test GIF",
        },
      ],
    };

    const gifRender = await this.timeOperation("gif-render", () =>
      Promise.resolve(this.adapter.render(gifPost))
    );

    results.push({
      name: "GIF Media Handling",
      passed: gifRender.result.ok === true,
      duration: gifRender.duration,
      error: gifRender.result.ok ? undefined : gifRender.result.error,
    });

    return results;
  }

  /**
   * Test X API v2 specific features
   */
  async testXAPIFeatures(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Analytics with X-specific metrics
    if (this.adapter.fetchAnalytics) {
      this.mockServer.mockSuccess("analytics");

      const analyticsResult = await this.timeOperation("x-analytics", () =>
        this.adapter.fetchAnalytics!({
          channelId: "test-channel",
          since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        })
      );

      results.push({
        name: "X Analytics Fetching",
        passed: analyticsResult.result.ok === true,
        duration: analyticsResult.duration,
        error: analyticsResult.result.ok ? undefined : analyticsResult.result.error,
        metadata: analyticsResult.result.ok
          ? {
              hasImpressions: "impressions" in analyticsResult.result.value.metrics,
              hasEngagements: "engagements" in analyticsResult.result.value.metrics,
              hasRetweets: "retweets" in analyticsResult.result.value.metrics,
            }
          : undefined,
      });
    }

    // Test 2: Quote tweet handling (if supported in future)
    const quotePost: CanonicalPost = {
      id: "quote-test",
      projectId: "test-project",
      locale: "en",
      body: "Quoting this tweet with additional context",
      // In future: quotedTweetId: "123456789"
    };

    const quoteRender = await this.timeOperation("quote-tweet-render", () =>
      Promise.resolve(this.adapter.render(quotePost))
    );

    results.push({
      name: "Quote Tweet Rendering",
      passed: quoteRender.result.ok === true,
      duration: quoteRender.duration,
      error: quoteRender.result.ok ? undefined : quoteRender.result.error,
    });

    return results;
  }

  /**
   * Test X-specific error scenarios
   */
  async testXSpecificErrors(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Duplicate tweet detection
    const duplicatePost = this.createValidPost();

    // Mock duplicate content error
    this.mockServer.mockValidationError("publish", "duplicate");

    const duplicateResult = await this.timeOperation("duplicate-tweet", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: { text: duplicatePost.body, media: duplicatePost.media },
      })
    );

    results.push({
      name: "Duplicate Tweet Handling",
      passed: !duplicateResult.result.ok && duplicateResult.result.error === "VALIDATION",
      duration: duplicateResult.duration,
      error: duplicateResult.result.ok ? "Expected validation error" : undefined,
    });

    // Test 2: Thread interruption (partial failure)
    if (this.adapter.publishThread) {
      const threadPlan = this.adapter.planThread({
        id: "interrupt-test",
        projectId: "test-project",
        locale: "en",
        body: "Thread that will be interrupted halfway through. ".repeat(10),
      });

      if (threadPlan.ok) {
        // Mock failure after first tweet
        this.mockServer.mockNetworkError("publish");

        const interruptResult = await this.timeOperation("thread-interruption", () =>
          this.adapter.publishThread!({
            channelId: "test-channel",
            threadPlan: threadPlan.value,
            dedupeKey: "interrupt-test-123",
          })
        );

        results.push({
          name: "Thread Interruption Handling",
          passed:
            !interruptResult.result.ok &&
            (interruptResult.result.error === "THREAD_INTERRUPTED" ||
              interruptResult.result.error === "NETWORK"),
          duration: interruptResult.duration,
          error: interruptResult.result.ok ? "Expected thread interruption error" : undefined,
        });
      }
    }

    return results;
  }

  /**
   * Run X-specific comprehensive test suite
   */
  async runXSpecificTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    try {
      const threadingResults = await this.testThreadingCapability();
      const mediaResults = await this.testXMediaHandling();
      const apiResults = await this.testXAPIFeatures();
      const errorResults = await this.testXSpecificErrors();

      results.push(...threadingResults, ...mediaResults, ...apiResults, ...errorResults);
    } catch (error) {
      results.push({
        name: "X-Specific Test Suite",
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return results;
  }
}

// Extend MockProviderServer for X-specific mocking
class _XMockProviderServer {
  mockValidationError(_endpoint: string, _type: "duplicate" | "too-long"): void {
    const _errors = {
      duplicate: { code: 187, message: "Status is a duplicate" },
      "too-long": { code: 186, message: "Status is over 280 characters" },
    };

    // Implementation would set up mock response for X API
  }
}

// Main execution function
async function runXProviderTests(): Promise<void> {
  // Skip when real X/Twitter credentials are not available
  if (!process.env.X_ACCESS_TOKEN) {
    console.log("⏭️  Skipping X/Twitter integration tests (X_ACCESS_TOKEN not set)");
    return;
  }

  console.log("🔬 Running X/Twitter Provider Integration Tests");
  console.log("================================================");

  const testSuite = new XProviderTest();

  try {
    // Run base test suite
    const baseReport = await testSuite.runFullTestSuite();

    // Run X-specific tests
    const xSpecificResults = await testSuite.runXSpecificTests();

    // Add X-specific results to report
    baseReport.testSuites.push({
      name: "X-Specific Features",
      results: xSpecificResults,
      duration: xSpecificResults.reduce((sum, r) => sum + (r.duration || 0), 0),
      passed: xSpecificResults.every((r) => r.passed),
    });

    // Update summary
    baseReport.summary.totalTests += xSpecificResults.length;
    baseReport.summary.passedTests += xSpecificResults.filter((r) => r.passed).length;
    baseReport.summary.failedTests = baseReport.summary.totalTests - baseReport.summary.passedTests;
    baseReport.summary.overallSuccess = baseReport.summary.failedTests === 0;

    // Print detailed report
    printTestReport(baseReport);
  } catch (error) {
    console.error("❌ X Provider test suite failed:", error);
    process.exit(1);
  }
}

function printTestReport(report: any): void {
  console.log(`\n📊 Test Results for ${report.providerId.toUpperCase()}`);
  console.log("================================");

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
    console.log("\n🎉 All X/Twitter provider tests passed!");
  } else {
    console.log("\n⚠️ Some X/Twitter provider tests failed.");
    process.exit(1);
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runXProviderTests().catch(console.error);
}
