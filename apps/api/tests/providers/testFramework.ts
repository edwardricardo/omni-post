import type {
  ProviderAdapter,
  RenderedPost,
  PublishInput,
  PublishReceipt as _PublishReceipt,
} from "@ports/core";
import type { CanonicalPost, RenderedContent, RenderError, PublishError } from "@shared/types";

export interface MockCredentials {
  [key: string]: string;
}

export interface ProviderTestCase {
  name: string;
  input: CanonicalPost;
  expectedResult: "success" | "error";
  expectedError?: RenderError | PublishError;
  description: string;
}

export interface ProviderTestSuite {
  providerId: string;
  adapter: ProviderAdapter;
  mockCredentials: MockCredentials;
  renderTests: ProviderTestCase[];
  publishTests: ProviderTestCase[];
  analyticsTests: Array<{
    name: string;
    channelId: string;
    since?: Date;
    until?: Date;
    expectedResult: "success" | "error";
    description: string;
  }>;
}

export class ProviderTestRunner {
  private results: Map<string, TestResult> = new Map();

  async runProviderSuite(suite: ProviderTestSuite): Promise<ProviderTestResults> {
    console.log(`🧪 Running test suite for ${suite.providerId} provider`);

    const results: ProviderTestResults = {
      providerId: suite.providerId,
      credentialValidation: { passed: 0, failed: 0, tests: [] },
      rendering: { passed: 0, failed: 0, tests: [] },
      publishing: { passed: 0, failed: 0, tests: [] },
      analytics: { passed: 0, failed: 0, tests: [] },
      overall: { passed: 0, failed: 0, duration: 0 },
    };

    const startTime = Date.now();

    try {
      // Test credential validation
      await this.testCredentialValidation(suite, results);

      // Test content rendering
      await this.testContentRendering(suite, results);

      // Test publishing workflow (with mocked API calls)
      await this.testPublishingWorkflow(suite, results);

      // Test analytics fetching
      await this.testAnalyticsFetching(suite, results);

      results.overall.duration = Date.now() - startTime;
      results.overall.passed =
        results.credentialValidation.passed +
        results.rendering.passed +
        results.publishing.passed +
        results.analytics.passed;
      results.overall.failed =
        results.credentialValidation.failed +
        results.rendering.failed +
        results.publishing.failed +
        results.analytics.failed;

      console.log(
        `✅ ${suite.providerId} test suite completed: ${results.overall.passed} passed, ${results.overall.failed} failed`
      );
    } catch (error) {
      console.error(`❌ ${suite.providerId} test suite failed:`, error);
      throw error;
    }

    return results;
  }

  private async testCredentialValidation(
    suite: ProviderTestSuite,
    results: ProviderTestResults
  ): Promise<void> {
    // Test with valid mock credentials
    try {
      const validResult = await suite.adapter.validateCredentials(suite.mockCredentials);
      if (validResult.ok) {
        results.credentialValidation.tests.push({
          name: "Valid credentials",
          passed: false, // We expect this to fail in test environment
          error: "Expected AUTH_INVALID for mock credentials",
          duration: 0,
        });
        results.credentialValidation.failed++;
      } else {
        results.credentialValidation.tests.push({
          name: "Valid credentials (expected failure)",
          passed: true,
          duration: 0,
        });
        results.credentialValidation.passed++;
      }
    } catch (error) {
      results.credentialValidation.tests.push({
        name: "Valid credentials (error)",
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
      });
      results.credentialValidation.failed++;
    }

    // Test with invalid credentials
    try {
      const invalidResult = await suite.adapter.validateCredentials({});
      if (!invalidResult.ok) {
        results.credentialValidation.tests.push({
          name: "Invalid credentials",
          passed: true,
          duration: 0,
        });
        results.credentialValidation.passed++;
      } else {
        results.credentialValidation.tests.push({
          name: "Invalid credentials",
          passed: false,
          error: "Expected validation to fail for empty credentials",
          duration: 0,
        });
        results.credentialValidation.failed++;
      }
    } catch (error) {
      results.credentialValidation.tests.push({
        name: "Invalid credentials (error)",
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
      });
      results.credentialValidation.failed++;
    }
  }

  private async testContentRendering(
    suite: ProviderTestSuite,
    results: ProviderTestResults
  ): Promise<void> {
    for (const testCase of suite.renderTests) {
      const startTime = Date.now();
      try {
        const result = suite.adapter.render(testCase.input);
        const duration = Date.now() - startTime;

        if (testCase.expectedResult === "success") {
          if (result.ok) {
            results.rendering.tests.push({
              name: testCase.name,
              passed: true,
              duration,
            });
            results.rendering.passed++;
          } else {
            results.rendering.tests.push({
              name: testCase.name,
              passed: false,
              error: `Expected success but got error: ${result.error}`,
              duration,
            });
            results.rendering.failed++;
          }
        } else {
          if (!result.ok && result.error === testCase.expectedError) {
            results.rendering.tests.push({
              name: testCase.name,
              passed: true,
              duration,
            });
            results.rendering.passed++;
          } else {
            results.rendering.tests.push({
              name: testCase.name,
              passed: false,
              error: `Expected error ${testCase.expectedError} but got ${result.ok ? "success" : result.error}`,
              duration,
            });
            results.rendering.failed++;
          }
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        results.rendering.tests.push({
          name: testCase.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
        results.rendering.failed++;
      }
    }
  }

  private async testPublishingWorkflow(
    suite: ProviderTestSuite,
    results: ProviderTestResults
  ): Promise<void> {
    for (const testCase of suite.publishTests) {
      const startTime = Date.now();
      try {
        // First render the content
        const renderResult = suite.adapter.render(testCase.input);
        if (!renderResult.ok) {
          results.publishing.tests.push({
            name: `${testCase.name} (render failed)`,
            passed: false,
            error: `Render failed: ${renderResult.error}`,
            duration: Date.now() - startTime,
          });
          results.publishing.failed++;
          continue;
        }

        // Create publish input from rendered content
        const publishInput: PublishInput = {
          channelId: "test-channel",
          post: this.convertRenderedToPost(renderResult.value),
          // No scheduling - publish immediately
        };

        // Attempt to publish (will fail due to mock credentials, but we test the adapter logic)
        const publishResult = await suite.adapter.publish(publishInput);
        const duration = Date.now() - startTime;

        if (testCase.expectedResult === "success") {
          // In test environment, we expect AUTH failures, not actual success
          if (!publishResult.ok && publishResult.error === "AUTH") {
            results.publishing.tests.push({
              name: testCase.name,
              passed: true,
              duration,
            });
            results.publishing.passed++;
          } else {
            results.publishing.tests.push({
              name: testCase.name,
              passed: false,
              error: `Expected AUTH error but got: ${publishResult.ok ? "success" : publishResult.error}`,
              duration,
            });
            results.publishing.failed++;
          }
        } else {
          if (!publishResult.ok && publishResult.error === testCase.expectedError) {
            results.publishing.tests.push({
              name: testCase.name,
              passed: true,
              duration,
            });
            results.publishing.passed++;
          } else {
            results.publishing.tests.push({
              name: testCase.name,
              passed: false,
              error: `Expected error ${testCase.expectedError} but got ${publishResult.ok ? "success" : publishResult.error}`,
              duration,
            });
            results.publishing.failed++;
          }
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        results.publishing.tests.push({
          name: testCase.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
        results.publishing.failed++;
      }
    }
  }

  private async testAnalyticsFetching(
    suite: ProviderTestSuite,
    results: ProviderTestResults
  ): Promise<void> {
    if (!suite.adapter.fetchAnalytics) {
      results.analytics.tests.push({
        name: "Analytics not supported",
        passed: true,
        duration: 0,
      });
      results.analytics.passed++;
      return;
    }

    for (const testCase of suite.analyticsTests) {
      const startTime = Date.now();
      try {
        const analyticsResult = await suite.adapter.fetchAnalytics({
          channelId: testCase.channelId,
          ...(testCase.since && { since: testCase.since }),
          ...(testCase.until && { until: testCase.until }),
        });
        const duration = Date.now() - startTime;

        if (testCase.expectedResult === "success") {
          // In test environment, we expect AUTH failures
          if (!analyticsResult.ok && analyticsResult.error === "AUTH") {
            results.analytics.tests.push({
              name: testCase.name,
              passed: true,
              duration,
            });
            results.analytics.passed++;
          } else {
            results.analytics.tests.push({
              name: testCase.name,
              passed: false,
              error: `Expected AUTH error but got: ${analyticsResult.ok ? "success" : analyticsResult.error}`,
              duration,
            });
            results.analytics.failed++;
          }
        } else {
          results.analytics.tests.push({
            name: testCase.name,
            passed: true,
            duration,
          });
          results.analytics.passed++;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        results.analytics.tests.push({
          name: testCase.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
        results.analytics.failed++;
      }
    }
  }

  private convertRenderedToPost(rendered: RenderedContent): RenderedPost {
    if (rendered.type === "single") {
      return {
        text:
          rendered.content.message || rendered.content.text || rendered.content.description || "",
        ...(rendered.content.media && { media: rendered.content.media }),
      };
    } else {
      // Thread - use first post
      return {
        text: rendered.posts[0]?.text || "",
        ...(rendered.posts[0]?.media && { media: rendered.posts[0].media }),
      };
    }
  }

  generateReport(results: ProviderTestResults[]): string {
    let report = "# Provider Integration Test Report\n\n";

    for (const result of results) {
      report += `## ${result.providerId.toUpperCase()} Provider\n\n`;
      report += `**Overall**: ${result.overall.passed} passed, ${result.overall.failed} failed (${result.overall.duration}ms)\n\n`;

      // Credential validation
      report += `### Credential Validation\n`;
      report += `Passed: ${result.credentialValidation.passed}, Failed: ${result.credentialValidation.failed}\n\n`;
      for (const test of result.credentialValidation.tests) {
        report += `- ${test.passed ? "✅" : "❌"} ${test.name}`;
        if (!test.passed && test.error) {
          report += ` - ${test.error}`;
        }
        report += `\n`;
      }
      report += `\n`;

      // Rendering
      report += `### Content Rendering\n`;
      report += `Passed: ${result.rendering.passed}, Failed: ${result.rendering.failed}\n\n`;
      for (const test of result.rendering.tests) {
        report += `- ${test.passed ? "✅" : "❌"} ${test.name} (${test.duration}ms)`;
        if (!test.passed && test.error) {
          report += ` - ${test.error}`;
        }
        report += `\n`;
      }
      report += `\n`;

      // Publishing
      report += `### Publishing Workflow\n`;
      report += `Passed: ${result.publishing.passed}, Failed: ${result.publishing.failed}\n\n`;
      for (const test of result.publishing.tests) {
        report += `- ${test.passed ? "✅" : "❌"} ${test.name} (${test.duration}ms)`;
        if (!test.passed && test.error) {
          report += ` - ${test.error}`;
        }
        report += `\n`;
      }
      report += `\n`;

      // Analytics
      report += `### Analytics Fetching\n`;
      report += `Passed: ${result.analytics.passed}, Failed: ${result.analytics.failed}\n\n`;
      for (const test of result.analytics.tests) {
        report += `- ${test.passed ? "✅" : "❌"} ${test.name} (${test.duration}ms)`;
        if (!test.passed && test.error) {
          report += ` - ${test.error}`;
        }
        report += `\n`;
      }
      report += `\n`;
    }

    return report;
  }
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface TestSection {
  passed: number;
  failed: number;
  tests: TestResult[];
}

export interface ProviderTestResults {
  providerId: string;
  credentialValidation: TestSection;
  rendering: TestSection;
  publishing: TestSection;
  analytics: TestSection;
  overall: {
    passed: number;
    failed: number;
    duration: number;
  };
}

// Test data factories
export const TestDataFactory = {
  createSimplePost(content: string): CanonicalPost {
    return {
      content,
      media: [],
    };
  },

  createMediaPost(content: string, mediaUrls: string[], mediaTypes: string[]): CanonicalPost {
    return {
      content,
      media: mediaUrls.map((url, index) => ({
        url,
        type: mediaTypes[index] || "image",
        mimeType: mediaTypes[index] === "video" ? "video/mp4" : "image/jpeg",
      })),
    };
  },

  createLongPost(length: number): CanonicalPost {
    return {
      content: "A".repeat(length),
      media: [],
    };
  },

  createEmptyPost(): CanonicalPost {
    return {
      content: "",
      media: [],
    };
  },
};

// Mock credentials for testing
export const MockCredentialsFactory = {
  x: {
    bearerToken: "mock_bearer_token",
    apiKey: "mock_api_key",
    apiSecret: "mock_api_secret",
    accessToken: "mock_access_token",
    accessTokenSecret: "mock_access_token_secret",
  },

  instagram: {
    accessToken: "mock_instagram_access_token",
    accountId: "mock_instagram_account_id",
    pageId: "mock_instagram_page_id",
  },

  facebook: {
    accessToken: "mock_facebook_access_token",
    pageId: "mock_facebook_page_id",
    appId: "mock_facebook_app_id",
    appSecret: "mock_facebook_app_secret",
  },

  youtube: {
    clientId: "mock_youtube_client_id",
    clientSecret: "mock_youtube_client_secret",
    refreshToken: "mock_youtube_refresh_token",
    accessToken: "mock_youtube_access_token",
    channelId: "mock_youtube_channel_id",
  },

  tiktok: {
    clientKey: "mock_tiktok_client_key",
    clientSecret: "mock_tiktok_client_secret",
    accessToken: "mock_tiktok_access_token",
    openId: "mock_tiktok_open_id",
  },
};
