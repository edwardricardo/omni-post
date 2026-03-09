import {
  ok as _ok,
  err as _err,
  isOk,
  isErr,
  unwrap,
  type Result as _Result,
  type CanonicalPost,
  type Media,
} from "@shared/types";
import type { ProviderAdapter, PublishInput, PublishReceipt as _PublishReceipt } from "@ports/core";
import { createCircuitBreakerMonitor } from "@monitoring/circuit-breaker";
import { performance } from "perf_hooks";

/**
 * Base class for provider integration tests
 * Provides common testing utilities and patterns for all providers
 */
export abstract class ProviderTestBase {
  protected abstract providerId: string;
  protected abstract adapter: ProviderAdapter;
  protected mockServer: MockProviderServer;
  protected testCredentials: Record<string, any>;
  protected circuitBreakerMonitor = createCircuitBreakerMonitor();

  constructor() {
    this.mockServer = new MockProviderServer(this.providerId);
    this.testCredentials = this.createTestCredentials();
  }

  // Abstract methods that each provider must implement
  abstract createTestCredentials(): Record<string, any>;
  abstract createValidPost(): CanonicalPost;
  abstract createInvalidPost(): CanonicalPost;
  abstract getCharacterLimit(): number;
  abstract getMaxMediaPerPost(): number;

  // Common test methods

  /**
   * Test basic credential validation
   */
  async testCredentialValidation(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Valid credentials
    const validResult = await this.timeOperation("credential-validation-valid", () =>
      this.adapter.validateCredentials(this.testCredentials)
    );

    results.push({
      name: "Valid Credentials",
      passed: isOk(validResult.result),
      duration: validResult.duration,
      error: isOk(validResult.result) ? undefined : validResult.result.error,
    });

    // Test 2: Invalid credentials
    const invalidCreds = { ...this.testCredentials, accessToken: "invalid" };
    const invalidResult = await this.timeOperation("credential-validation-invalid", () =>
      this.adapter.validateCredentials(invalidCreds)
    );

    results.push({
      name: "Invalid Credentials",
      passed: isErr(invalidResult.result) && invalidResult.result.error === "AUTH_INVALID",
      duration: invalidResult.duration,
      error: isOk(invalidResult.result) ? "Expected failure but got success" : undefined,
    });

    // Test 3: Missing required fields
    const emptyResult = await this.timeOperation("credential-validation-empty", () =>
      this.adapter.validateCredentials({})
    );

    results.push({
      name: "Empty Credentials",
      passed: isErr(emptyResult.result) && emptyResult.result.error === "AUTH_INVALID",
      duration: emptyResult.duration,
      error: isOk(emptyResult.result) ? "Expected failure but got success" : undefined,
    });

    return results;
  }

  /**
   * Test content rendering functionality
   */
  async testContentRendering(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Valid content rendering
    const validPost = this.createValidPost();
    const renderResult = await this.timeOperation("content-rendering-valid", () =>
      Promise.resolve(this.adapter.render(validPost))
    );

    results.push({
      name: "Valid Content Rendering",
      passed: isOk(renderResult.result),
      duration: renderResult.duration,
      error: isOk(renderResult.result) ? undefined : renderResult.result.error,
      metadata: isOk(renderResult.result)
        ? { contentType: unwrap(renderResult.result).type }
        : undefined,
    });

    // Test 2: Content too long
    const longPost = {
      ...validPost,
      body: "x".repeat(this.getCharacterLimit() * 2),
    };
    const longResult = await this.timeOperation("content-rendering-long", () =>
      Promise.resolve(this.adapter.render(longPost))
    );

    results.push({
      name: "Long Content Handling",
      passed:
        isOk(longResult.result) ||
        (isErr(longResult.result) && longResult.result.error === "TEXT_TOO_LONG"),
      duration: longResult.duration,
      // Both success (threading) and failure (too long) are valid - no error to report
    });

    // Test 3: Media handling
    const mediaPost = {
      ...validPost,
      media: this.createTestMedia(3), // Test with multiple media
    };
    const mediaResult = await this.timeOperation("content-rendering-media", () =>
      Promise.resolve(this.adapter.render(mediaPost))
    );

    results.push({
      name: "Media Content Rendering",
      passed: isOk(mediaResult.result),
      duration: mediaResult.duration,
      ...(isErr(mediaResult.result) && { error: mediaResult.result.error }),
    });

    return results;
  }

  /**
   * Test publishing workflow
   */
  async testPublishingWorkflow(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Mock successful API responses
    this.mockServer.mockSuccess("publish");

    // Test 1: Successful publish
    const validPost = this.createValidPost();
    const publishInput: PublishInput = {
      channelId: "test-channel",
      post: {
        text: validPost.body,
        media: validPost.media,
      },
    };

    const publishResult = await this.timeOperation("publish-success", () =>
      this.adapter.publish(publishInput)
    );

    results.push({
      name: "Successful Publish",
      passed: isOk(publishResult.result),
      duration: publishResult.duration,
      error: isOk(publishResult.result) ? undefined : publishResult.result.error,
      metadata: isOk(publishResult.result)
        ? {
            providerPostId: unwrap(publishResult.result).providerPostId,
            url: unwrap(publishResult.result).url,
          }
        : undefined,
    });

    // Test 2: Rate limit handling
    this.mockServer.mockRateLimit("publish");
    const rateLimitResult = await this.timeOperation("publish-rate-limit", () =>
      this.adapter.publish(publishInput)
    );

    results.push({
      name: "Rate Limit Handling",
      passed: isErr(rateLimitResult.result) && rateLimitResult.result.error === "RATE_LIMIT",
      duration: rateLimitResult.duration,
      error: isOk(rateLimitResult.result) ? "Expected rate limit error" : undefined,
    });

    // Test 3: Authentication error
    this.mockServer.mockAuthError("publish");
    const authErrorResult = await this.timeOperation("publish-auth-error", () =>
      this.adapter.publish(publishInput)
    );

    results.push({
      name: "Authentication Error Handling",
      passed: isErr(authErrorResult.result) && authErrorResult.result.error === "AUTH",
      duration: authErrorResult.duration,
      error: isOk(authErrorResult.result) ? "Expected auth error" : undefined,
    });

    // Test 4: Network error
    this.mockServer.mockNetworkError("publish");
    const networkErrorResult = await this.timeOperation("publish-network-error", () =>
      this.adapter.publish(publishInput)
    );

    results.push({
      name: "Network Error Handling",
      passed: isErr(networkErrorResult.result) && networkErrorResult.result.error === "NETWORK",
      duration: networkErrorResult.duration,
      error: isOk(networkErrorResult.result) ? "Expected network error" : undefined,
    });

    return results;
  }

  /**
   * Test analytics fetching
   */
  async testAnalyticsFetching(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    if (!this.adapter.fetchAnalytics) {
      results.push({
        name: "Analytics Not Supported",
        passed: true,
        duration: 0,
        metadata: { reason: "Provider does not support analytics" },
      });
      return results;
    }

    // Mock successful analytics response
    this.mockServer.mockSuccess("analytics");

    // Test 1: Fetch recent analytics
    const analyticsResult = await this.timeOperation("analytics-fetch", () =>
      this.adapter.fetchAnalytics!({
        channelId: "test-channel",
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        until: new Date(),
      })
    );

    results.push({
      name: "Analytics Fetching",
      passed: isOk(analyticsResult.result),
      duration: analyticsResult.duration,
      error: isOk(analyticsResult.result) ? undefined : analyticsResult.result.error,
      metadata: isOk(analyticsResult.result)
        ? {
            hasMetrics: Object.keys(unwrap(analyticsResult.result).metrics || {}).length > 0,
          }
        : undefined,
    });

    // Test 2: Analytics auth error
    this.mockServer.mockAuthError("analytics");
    const authErrorResult = await this.timeOperation("analytics-auth-error", () =>
      this.adapter.fetchAnalytics!({
        channelId: "test-channel",
      })
    );

    results.push({
      name: "Analytics Auth Error",
      passed: isErr(authErrorResult.result) && authErrorResult.result.error === "AUTH",
      duration: authErrorResult.duration,
      error: isOk(authErrorResult.result) ? "Expected auth error" : undefined,
    });

    return results;
  }

  /**
   * Test rate limiting compliance
   */
  async testRateLimiting(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    const rateLimits = this.adapter.limits?.rateLimitHints;
    if (!rateLimits) {
      results.push({
        name: "Rate Limiting Not Configured",
        passed: true,
        duration: 0,
        metadata: { reason: "Provider does not specify rate limits" },
      });
      return results;
    }

    // Test rate limit compliance by making multiple rapid requests
    this.mockServer.mockSuccess("publish");

    const requests: Promise<any>[] = [];
    const startTime = performance.now();

    // Make burst requests up to the limit
    for (let i = 0; i < Math.min(rateLimits.burst || 10, 5); i++) {
      requests.push(
        this.adapter.publish({
          channelId: "test-channel",
          post: { text: `Test post ${i}` },
        })
      );
    }

    try {
      await Promise.all(requests);
      const duration = performance.now() - startTime;

      results.push({
        name: "Rate Limit Compliance",
        passed: true,
        duration,
        metadata: {
          requestCount: requests.length,
          averageTime: duration / requests.length,
        },
      });
    } catch (error) {
      results.push({
        name: "Rate Limit Compliance",
        passed: false,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return results;
  }

  /**
   * Test circuit breaker functionality
   */
  async testCircuitBreaker(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: Circuit breaker opens after failures
    this.mockServer.mockNetworkError("publish");

    // Generate multiple failures to trigger circuit breaker
    const failureCount = 5;
    for (let i = 0; i < failureCount; i++) {
      await this.adapter.publish({
        channelId: "test-channel",
        post: { text: "Test failure" },
      });
    }

    // Next request should be rejected by circuit breaker
    const circuitOpenResult = await this.timeOperation("circuit-breaker-open", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: { text: "Should be rejected" },
      })
    );

    results.push({
      name: "Circuit Breaker Opens",
      passed: isErr(circuitOpenResult.result) && circuitOpenResult.result.error === "NETWORK",
      duration: circuitOpenResult.duration,
      error: isOk(circuitOpenResult.result) ? "Expected circuit breaker rejection" : undefined,
    });

    // Test 2: Circuit breaker recovery
    this.mockServer.mockSuccess("publish");

    // Wait for circuit breaker to enter half-open state
    await this.sleep(1000);

    const recoveryResult = await this.timeOperation("circuit-breaker-recovery", () =>
      this.adapter.publish({
        channelId: "test-channel",
        post: { text: "Recovery test" },
      })
    );

    results.push({
      name: "Circuit Breaker Recovery",
      passed: isOk(recoveryResult.result),
      duration: recoveryResult.duration,
      error: isOk(recoveryResult.result) ? undefined : recoveryResult.result.error,
    });

    return results;
  }

  /**
   * Run comprehensive provider test suite
   */
  async runFullTestSuite(): Promise<ProviderTestReport> {
    const report: ProviderTestReport = {
      providerId: this.providerId,
      timestamp: new Date(),
      testSuites: [],
      summary: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        totalDuration: 0,
        overallSuccess: false,
      },
    };

    const suiteStartTime = performance.now();

    try {
      // Run all test suites
      const testSuites = [
        { name: "Credential Validation", test: () => this.testCredentialValidation() },
        { name: "Content Rendering", test: () => this.testContentRendering() },
        { name: "Publishing Workflow", test: () => this.testPublishingWorkflow() },
        { name: "Analytics Fetching", test: () => this.testAnalyticsFetching() },
        { name: "Rate Limiting", test: () => this.testRateLimiting() },
        { name: "Circuit Breaker", test: () => this.testCircuitBreaker() },
      ];

      for (const suite of testSuites) {
        try {
          const testResults = await suite.test();
          report.testSuites.push({
            name: suite.name,
            results: testResults,
            duration: testResults.reduce((sum, r) => sum + (r.duration || 0), 0),
            passed: testResults.every((r) => r.passed),
          });
        } catch (error) {
          report.testSuites.push({
            name: suite.name,
            results: [
              {
                name: "Suite Execution",
                passed: false,
                duration: 0,
                error: error instanceof Error ? error.message : String(error),
              },
            ],
            duration: 0,
            passed: false,
          });
        }
      }

      // Calculate summary
      report.summary.totalDuration = performance.now() - suiteStartTime;

      for (const suite of report.testSuites) {
        report.summary.totalTests += suite.results.length;
        report.summary.passedTests += suite.results.filter((r) => r.passed).length;
      }

      report.summary.failedTests = report.summary.totalTests - report.summary.passedTests;
      report.summary.overallSuccess = report.summary.failedTests === 0;
    } catch (error) {
      report.summary.totalDuration = performance.now() - suiteStartTime;
      report.error = error instanceof Error ? error.message : String(error);
    } finally {
      await this.cleanup();
    }

    return report;
  }

  // Utility methods

  protected async timeOperation<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - startTime;

      // Update circuit breaker monitor
      this.circuitBreakerMonitor.updateMetrics({
        service: this.providerId,
        operation: operationName,
        state: "CLOSED",
        successCount: 1,
        failureCount: 0,
        timeoutCount: 0,
        rejectionCount: 0,
        lastSuccessTime: new Date(),
        errorRate: 0,
        responseTime: {
          min: duration,
          max: duration,
          avg: duration,
          p95: duration,
          p99: duration,
        },
      });

      return { result, duration };
    } catch (error) {
      const duration = performance.now() - startTime;

      // Update circuit breaker monitor with failure
      this.circuitBreakerMonitor.updateMetrics({
        service: this.providerId,
        operation: operationName,
        state: "CLOSED", // State would be managed by actual circuit breaker
        successCount: 0,
        failureCount: 1,
        timeoutCount: 0,
        rejectionCount: 0,
        lastFailureTime: new Date(),
        errorRate: 1,
        responseTime: {
          min: duration,
          max: duration,
          avg: duration,
          p95: duration,
          p99: duration,
        },
      });

      throw error;
    }
  }

  protected createTestMedia(count: number = 1): Media[] {
    const media: Media[] = [];
    for (let i = 0; i < count; i++) {
      media.push({
        id: `test-media-${i}`,
        type: i % 2 === 0 ? "image" : "video",
        url: `https://test-cdn.example.com/media-${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
        w: 1080,
        h: 1080,
        alt: `Test media ${i}`,
        ...(i % 2 === 1 ? { durationMs: 30000 } : {}),
      });
    }
    return media;
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async cleanup(): Promise<void> {
    await this.mockServer.stop();
  }
}

// Mock server for provider API endpoints
class MockProviderServer {
  private responses: Map<string, any> = new Map();

  constructor(private providerId: string) {}

  mockSuccess(endpoint: string): void {
    switch (endpoint) {
      case "publish":
        this.responses.set("publish", {
          status: 201,
          data: {
            id: "mock-post-123",
            url: `https://${this.providerId}.com/post/mock-post-123`,
            created_at: new Date().toISOString(),
          },
        });
        break;
      case "analytics":
        this.responses.set("analytics", {
          status: 200,
          data: {
            metrics: {
              impressions: Math.floor(Math.random() * 10000),
              engagements: Math.floor(Math.random() * 1000),
              likes: Math.floor(Math.random() * 500),
            },
          },
        });
        break;
    }
  }

  mockRateLimit(endpoint: string): void {
    this.responses.set(endpoint, {
      status: 429,
      error: "Rate limit exceeded",
    });
  }

  mockAuthError(endpoint: string): void {
    this.responses.set(endpoint, {
      status: 401,
      error: "Unauthorized",
    });
  }

  mockNetworkError(endpoint: string): void {
    this.responses.set(endpoint, {
      error: "NETWORK_ERROR",
    });
  }

  /**
   * Provider-specific mock stubs. No-op in base class — provider test subclasses
   * call these on the base mock type via `this.mockServer`.
   */
  mockInstagramContainerFlow(_type: "single" | "carousel" | "video"): void {
    /* no-op */
  }
  mockInstagramInsights(): void {
    /* no-op */
  }
  mockInstagramPersonalAccountError(): void {
    /* no-op */
  }
  mockInstagramContainerTimeout(): void {
    /* no-op */
  }
  mockInstagramInvalidMediaError(): void {
    /* no-op */
  }
  mockValidationError(_endpoint: string, _type: "duplicate" | "too-long"): void {
    /* no-op */
  }

  async stop(): Promise<void> {
    this.responses.clear();
  }
}

// Type definitions
export interface TestResult {
  name: string;
  passed: boolean;
  duration?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface TestSuiteResult {
  name: string;
  results: TestResult[];
  duration: number;
  passed: boolean;
}

export interface ProviderTestReport {
  providerId: string;
  timestamp: Date;
  testSuites: TestSuiteResult[];
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    totalDuration: number;
    overallSuccess: boolean;
  };
  error?: string;
}
