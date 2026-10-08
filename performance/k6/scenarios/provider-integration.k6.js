import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { AuthHelper, createAuthenticatedUser } from "../utils/auth-helpers.js";
import { DataGenerator } from "../utils/data-generators.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics
const providerConnectionRate = new Rate("provider_connection_success_rate");
const providerResponseTime = new Trend("provider_response_time");
const rateLimitComplianceRate = new Rate("rate_limit_compliance_rate");
const circuitBreakerTrips = new Counter("circuit_breaker_trips");
const providerTimeouts = new Counter("provider_timeouts");
// const providerRetries = new Counter('provider_retries'); // Reserved for future retry tracking
const publishAttempts = new Counter("publish_attempts");
const publishSuccesses = new Counter("publish_successes");

// Test configuration
export const options = {
  stages: [
    { duration: "30s", target: 15 }, // Warm up providers
    { duration: "1m", target: 30 }, // Light provider load
    { duration: "2m", target: 60 }, // Moderate provider load
    { duration: "2m", target: 100 }, // Heavy provider load
    { duration: "1m", target: 150 }, // Peak provider load
    { duration: "3m", target: 150 }, // Sustained peak
    { duration: "1m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"], // Higher tolerance for provider failures
    provider_connection_success_rate: ["rate>0.95"],
    provider_response_time: ["p(95)<3000"],
    rate_limit_compliance_rate: ["rate>0.98"],
    checks: ["rate>0.90"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const dataGenerator = new DataGenerator();
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up provider integration performance test...");

  // Health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  // Create test user and project
  const testUser = createAuthenticatedUser(authHelper, 0);
  const headers = authHelper.getAuthHeaders(testUser.token);

  const projectData = dataGenerator.generateProject();
  const projectResponse = http.post(`${BASE_URL}/api/projects`, JSON.stringify(projectData), {
    headers,
  });

  let projectId = null;
  if (projectResponse.status === 201) {
    projectId = projectResponse.json("id");
  }

  return {
    baseUrl: BASE_URL,
    testUser,
    projectId,
    testStartTime: new Date().toISOString(),
  };
}

export default function providerIntegrationTest(data) {
  const userIndex = Math.floor(Math.random() * 100);
  let auth;

  try {
    auth = createAuthenticatedUser(authHelper, userIndex);
  } catch (error) {
    console.error("Authentication failed:", error);
    return;
  }

  const headers = authHelper.getAuthHeaders(auth.token);
  const projectId = data.projectId;

  if (!projectId) {
    console.error("No project available for provider testing");
    return;
  }

  const providers = ["x", "facebook", "instagram", "youtube", "tiktok"];

  group("Provider Integration Performance", () => {
    // Test 1: Provider Connection Status
    group("Provider Status Check", () => {
      providers.forEach((provider) => {
        const startTime = Date.now();

        const response = http.get(`${BASE_URL}/api/providers/${provider}/status`, { headers });

        const duration = Date.now() - startTime;
        providerResponseTime.add(duration);

        const success = assertions.checkProviderIntegration(response, provider);
        providerConnectionRate.add(success);

        sleep(0.1);
      });
    });

    // Test 2: Provider Authentication Flow
    group("Provider Authentication", () => {
      providers.forEach((provider) => {
        // Initiate OAuth flow
        const oauthResponse = http.get(`${BASE_URL}/api/providers/${provider}/auth/init`, {
          headers,
        });

        assertions.checkApiResponse(oauthResponse, [200, 302], {
          [`${provider} oauth initiation`]: (r) => r.status === 200 || r.status === 302,
        });

        // Simulate callback (simplified)
        const callbackResponse = http.post(
          `${BASE_URL}/api/providers/${provider}/auth/callback`,
          JSON.stringify({
            code: "test_auth_code",
            state: "test_state",
          }),
          { headers }
        );

        // We expect this to fail in test environment, but endpoint should respond
        check(callbackResponse, {
          [`${provider} callback responds`]: (r) =>
            r.status === 400 || r.status === 401 || r.status === 200,
        });

        sleep(0.2);
      });
    });

    // Test 3: Channel Connection Testing
    group("Channel Connection", () => {
      providers.forEach((provider) => {
        const channelData = dataGenerator.generateChannel(provider);

        const response = http.post(
          `${BASE_URL}/api/projects/${projectId}/channels`,
          JSON.stringify(channelData),
          { headers }
        );

        assertions.checkApiResponse(response, 201, {
          [`${provider} channel connected`]: (r) => r.json("id") !== undefined,
        });

        sleep(0.1);
      });
    });

    // Test 4: Publishing to Providers
    group("Provider Publishing", () => {
      const postData = dataGenerator.generatePostContent("text");

      providers.forEach((provider) => {
        const startTime = Date.now();
        publishAttempts.add(1);

        const publishData = {
          ...postData,
          provider,
          testMode: true, // Don't actually publish in test
        };

        const response = http.post(
          `${BASE_URL}/api/providers/${provider}/publish`,
          JSON.stringify(publishData),
          { headers }
        );

        const duration = Date.now() - startTime;
        providerResponseTime.add(duration);

        // Check for rate limiting compliance
        const rateLimitHeaders =
          response.headers["X-RateLimit-Remaining"] || response.headers["x-ratelimit-remaining"];
        if (rateLimitHeaders) {
          const remaining = parseInt(rateLimitHeaders);
          rateLimitComplianceRate.add(remaining > 0);
        }

        const success = assertions.checkProviderIntegration(response, provider);
        if (success) {
          publishSuccesses.add(1);
        }

        // Check for circuit breaker
        if (response.status === 503) {
          circuitBreakerTrips.add(1);
        }

        // Check for timeouts
        if (response.timings.duration > 30000) {
          providerTimeouts.add(1);
        }

        sleep(0.3);
      });
    });

    // Test 5: Provider Rate Limiting
    group("Rate Limiting Test", () => {
      const provider = providers[Math.floor(Math.random() * providers.length)];

      // Rapid-fire requests to test rate limiting
      for (let i = 0; i < 10; i++) {
        const response = http.get(`${BASE_URL}/api/providers/${provider}/rate-limit-test`, {
          headers,
        });

        if (response.status === 429) {
          // Rate limit hit - this is expected
          rateLimitComplianceRate.add(true);
          break;
        }

        sleep(0.1);
      }
    });

    // Test 6: Provider Data Sync
    group("Provider Data Sync", () => {
      providers.forEach((provider) => {
        const response = http.post(
          `${BASE_URL}/api/providers/${provider}/sync`,
          JSON.stringify({
            projectId,
            syncType: "analytics",
            dateRange: "last_7_days",
          }),
          { headers }
        );

        assertions.checkApiResponse(response, [200, 202], {
          [`${provider} sync initiated`]: (r) => r.status === 200 || r.status === 202,
        });

        sleep(0.2);
      });
    });

    // Test 7: Provider Analytics Fetch
    group("Provider Analytics", () => {
      providers.forEach((provider) => {
        const testData = dataGenerator.generateProviderTestData(provider);

        const response = http.get(
          `${BASE_URL}/api/providers/${provider}/analytics?${new URLSearchParams(testData)}`,
          { headers }
        );

        assertions.checkApiResponse(response, 200, {
          [`${provider} analytics fetched`]: (r) => r.status === 200,
          [`${provider} analytics has data`]: (r) => r.json("data") !== undefined,
        });

        sleep(0.2);
      });
    });

    // Test 8: Circuit Breaker Testing
    group("Circuit Breaker Test", () => {
      const provider = "x"; // Test with X provider

      // Simulate failures to trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        const response = http.post(
          `${BASE_URL}/api/providers/${provider}/circuit-breaker-test`,
          JSON.stringify({ shouldFail: true }),
          { headers }
        );

        if (response.status === 503) {
          circuitBreakerTrips.add(1);
          assertions.checkCircuitBreaker(response, true);
          break;
        }

        sleep(0.1);
      }

      // Test recovery
      sleep(2); // Wait for potential recovery

      const recoveryResponse = http.get(`${BASE_URL}/api/providers/${provider}/status`, {
        headers,
      });

      assertions.checkCircuitBreaker(recoveryResponse, false);
    });

    // Test 9: Bulk Provider Operations
    group("Bulk Provider Operations", () => {
      const bulkData = {
        posts: Array.from({ length: 5 }, () => dataGenerator.generatePostContent("text")),
        providers: providers.slice(0, 3), // Test with first 3 providers
        projectId,
      };

      const response = http.post(
        `${BASE_URL}/api/providers/bulk-publish`,
        JSON.stringify(bulkData),
        { headers }
      );

      assertions.checkBulkOperation(response, bulkData.posts.length * bulkData.providers.length);

      sleep(1);
    });

    // Test 10: Provider Error Handling
    group("Provider Error Handling", () => {
      providers.forEach((provider) => {
        // Test with invalid data to trigger error handling
        const invalidData = {
          content: "", // Empty content should trigger validation error
          provider,
        };

        const response = http.post(
          `${BASE_URL}/api/providers/${provider}/publish`,
          JSON.stringify(invalidData),
          { headers }
        );

        check(response, {
          [`${provider} error handling responds`]: (r) => r.status === 400,
          [`${provider} error has message`]: (r) => r.json("error") !== undefined,
        });

        sleep(0.1);
      });
    });

    // Test 11: Provider Health Monitoring
    group("Provider Health Check", () => {
      const response = http.get(`${BASE_URL}/api/providers/health`, { headers });

      assertions.checkApiResponse(response, 200, {
        "provider health check successful": (r) => r.status === 200,
        "provider health has status": (r) => r.json("providers") !== undefined,
      });

      sleep(0.1);
    });

    // Test 12: Provider Configuration
    group("Provider Configuration", () => {
      providers.forEach((provider) => {
        const configResponse = http.get(`${BASE_URL}/api/providers/${provider}/config`, {
          headers,
        });

        assertions.checkApiResponse(configResponse, 200, {
          [`${provider} config loaded`]: (r) => r.status === 200,
          [`${provider} config has limits`]: (r) => r.json("rateLimits") !== undefined,
        });

        sleep(0.1);
      });
    });
  });

  // Think time between provider operations
  sleep(Math.random() * 2 + 1);
}

export function teardown(/* data */) {
  console.log("Provider integration performance test completed");
  console.log(`Publish attempts: ${publishAttempts.count}`);
  console.log(`Publish successes: ${publishSuccesses.count}`);
  console.log(`Circuit breaker trips: ${circuitBreakerTrips.count}`);
  console.log(`Provider timeouts: ${providerTimeouts.count}`);

  // Final health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after provider test": (r) => r.status === 200,
  });
}
