import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { AuthHelper, createAuthenticatedUser } from "../utils/auth-helpers.js";
import { DataGenerator } from "../utils/data-generators.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics for API performance testing
const apiPerformanceRate = new Rate("api_performance_success_rate");
const endpointResponseTime = new Trend("endpoint_response_time");
const concurrentRequestsDuration = new Trend("concurrent_requests_duration");
const authenticationTime = new Trend("authentication_time");
const apiThroughput = new Counter("api_requests_per_second");
const cacheEfficiency = new Rate("cache_hit_rate");

// Test configuration for comprehensive API testing
export const options = {
  scenarios: {
    // Comprehensive API endpoint testing
    api_endpoints_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 25 }, // Ramp up
        { duration: "5m", target: 50 }, // Moderate load
        { duration: "3m", target: 100 }, // High load
        { duration: "5m", target: 100 }, // Sustained high load
        { duration: "2m", target: 0 }, // Ramp down
      ],
      exec: "apiEndpointsTest",
    },

    // Authentication performance testing
    authentication_load_test: {
      executor: "constant-arrival-rate",
      rate: 10, // 10 authentications per second
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: "authenticationLoadTest",
    },

    // Concurrent operations stress test
    concurrent_operations_test: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 500,
      maxDuration: "10m",
      exec: "concurrentOperationsTest",
    },

    // Cache performance testing
    cache_performance_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 40 },
        { duration: "1m", target: 0 },
      ],
      exec: "cachePerformanceTest",
    },
  },

  thresholds: {
    http_req_duration: ["p(95)<300", "p(99)<500"],
    http_req_failed: ["rate<0.01"],
    api_performance_success_rate: ["rate>0.99"],
    endpoint_response_time: ["p(95)<200"],
    authentication_time: ["p(95)<300"],
    concurrent_requests_duration: ["p(95)<1000"],
    cache_hit_rate: ["rate>0.80"],
    checks: ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const dataGenerator = new DataGenerator();
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up comprehensive API performance test...");

  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  return {
    baseUrl: BASE_URL,
    testStartTime: new Date().toISOString(),
  };
}

// Comprehensive API endpoints testing
export function apiEndpointsTest(/* data */) {
  let auth;

  try {
    auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 1000));
  } catch (error) {
    console.error("Authentication failed:", error);
    return;
  }

  const headers = authHelper.getAuthHeaders(auth.token);

  group("API Endpoints Performance", () => {
    // Test 1: Health and Status Endpoints
    group("Health and Status Endpoints", () => {
      const responses = [
        http.get(`${BASE_URL}/health`, { tags: { endpoint: "health" } }),
        http.get(`${BASE_URL}/metrics`, { tags: { endpoint: "metrics" } }),
        http.get(`${BASE_URL}/health/detailed`, { tags: { endpoint: "health_detailed" } }),
      ];

      responses.forEach((response, index) => {
        const endpointName = ["health", "metrics", "health_detailed"][index];
        endpointResponseTime.add(response.timings.duration, { endpoint: endpointName });

        const success = assertions.checkApiResponse(response, 200, {
          [`${endpointName} endpoint responsive`]: (r) => r.timings.duration < 100,
        });
        apiPerformanceRate.add(success);
        apiThroughput.add(1);
      });

      sleep(0.5);
    });

    // Test 2: Authentication Endpoints
    group("Authentication Endpoints", () => {
      // Profile access
      const profileStart = Date.now();
      const profileResponse = http.get(`${BASE_URL}/api/auth/profile`, { headers });
      const profileDuration = Date.now() - profileStart;

      authenticationTime.add(profileDuration);
      endpointResponseTime.add(profileResponse.timings.duration, { endpoint: "auth_profile" });

      const success = assertions.checkApiResponse(profileResponse, 200, {
        "profile endpoint fast": (r) => r.timings.duration < 200,
        "profile has user data": (r) => r.json("user") !== undefined,
      });
      apiPerformanceRate.add(success);
      apiThroughput.add(1);

      sleep(0.3);
    });

    // Test 3: Projects API
    group("Projects API", () => {
      // List projects
      const listResponse = http.get(`${BASE_URL}/api/projects`, { headers });
      endpointResponseTime.add(listResponse.timings.duration, { endpoint: "projects_list" });

      let projectId = null;
      if (listResponse.status === 200 && listResponse.json("data")) {
        const projects = listResponse.json("data");
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      // Create project if none exists
      if (!projectId) {
        const projectData = dataGenerator.generateProject();
        const createResponse = http.post(`${BASE_URL}/api/projects`, JSON.stringify(projectData), {
          headers,
        });
        endpointResponseTime.add(createResponse.timings.duration, { endpoint: "projects_create" });

        if (createResponse.status === 201) {
          projectId = createResponse.json("id");
        }
        apiThroughput.add(1);
      }

      const success = assertions.checkApiResponse(listResponse, 200, {
        "projects list fast": (r) => r.timings.duration < 300,
      });
      apiPerformanceRate.add(success);
      apiThroughput.add(1);

      sleep(0.4);
    });

    // Test 4: Posts API
    group("Posts API", () => {
      // Get random project for posts testing
      const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });
      let projectId = null;

      if (projectsResponse.status === 200) {
        const projects = projectsResponse.json("data");
        if (projects && projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      if (projectId) {
        // List posts
        const listPostsResponse = http.get(`${BASE_URL}/api/projects/${projectId}/posts`, {
          headers,
        });
        endpointResponseTime.add(listPostsResponse.timings.duration, { endpoint: "posts_list" });

        // Create post
        const postData = dataGenerator.generatePostContent("text");
        const createPostResponse = http.post(
          `${BASE_URL}/api/projects/${projectId}/posts`,
          JSON.stringify(postData),
          { headers }
        );
        endpointResponseTime.add(createPostResponse.timings.duration, { endpoint: "posts_create" });

        const success = assertions.checkApiResponse(createPostResponse, 201, {
          "post creation fast": (r) => r.timings.duration < 400,
        });
        apiPerformanceRate.add(success);
        apiThroughput.add(2); // Two requests
      }

      sleep(0.5);
    });

    // Test 5: Analytics API
    group("Analytics API", () => {
      const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });
      let projectId = null;

      if (projectsResponse.status === 200) {
        const projects = projectsResponse.json("data");
        if (projects && projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      if (projectId) {
        // Dashboard analytics
        const dashboardResponse = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/dashboard`,
          { headers }
        );
        endpointResponseTime.add(dashboardResponse.timings.duration, {
          endpoint: "analytics_dashboard",
        });

        // Time range analytics
        const rangeResponse = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics?range=week`,
          { headers }
        );
        endpointResponseTime.add(rangeResponse.timings.duration, { endpoint: "analytics_range" });

        const success = assertions.checkAnalyticsQuery(dashboardResponse, "week");
        apiPerformanceRate.add(success);
        apiThroughput.add(2);
      }

      sleep(0.6);
    });

    // Test 6: Provider Integration Endpoints
    group("Provider Integration", () => {
      const providers = ["x", "facebook", "instagram"];

      providers.forEach((provider) => {
        const statusResponse = http.get(`${BASE_URL}/api/providers/${provider}/status`, {
          headers,
        });
        endpointResponseTime.add(statusResponse.timings.duration, {
          endpoint: `provider_${provider}_status`,
        });

        const success = assertions.checkProviderIntegration(statusResponse, provider);
        apiPerformanceRate.add(success);
        apiThroughput.add(1);

        sleep(0.1);
      });

      sleep(0.3);
    });

    // Test 7: Bulk Operations
    group("Bulk Operations", () => {
      const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });
      let projectId = null;

      if (projectsResponse.status === 200) {
        const projects = projectsResponse.json("data");
        if (projects && projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      if (projectId) {
        const bulkPosts = Array.from({ length: 5 }, () =>
          dataGenerator.generatePostContent("text")
        );
        const bulkResponse = http.post(
          `${BASE_URL}/api/projects/${projectId}/posts/bulk`,
          JSON.stringify({ posts: bulkPosts }),
          { headers }
        );

        endpointResponseTime.add(bulkResponse.timings.duration, { endpoint: "posts_bulk_create" });

        const success = assertions.checkBulkOperation(bulkResponse, bulkPosts.length);
        apiPerformanceRate.add(success);
        apiThroughput.add(1);
      }

      sleep(0.8);
    });
  });

  // Random think time
  sleep(Math.random() * 2 + 1);
}

// Authentication load testing
export function authenticationLoadTest(/* data */) {
  group("Authentication Load Test", () => {
    const authStart = Date.now();

    try {
      const userIndex = Math.floor(Math.random() * 1000);
      const auth = createAuthenticatedUser(authHelper, userIndex);

      const authDuration = Date.now() - authStart;
      authenticationTime.add(authDuration);

      // Test token validation
      const validationResponse = authHelper.validateToken(auth.token);
      apiPerformanceRate.add(validationResponse);
      apiThroughput.add(1);

      // Test profile access
      const profileResponse = http.get(`${BASE_URL}/api/auth/profile`, {
        headers: authHelper.getAuthHeaders(auth.token),
      });

      const success = assertions.checkApiResponse(profileResponse, 200, {
        "auth load test profile access": (r) => r.status === 200,
      });
      apiPerformanceRate.add(success);
      apiThroughput.add(1);
    } catch (error) {
      apiPerformanceRate.add(false);
      console.error("Authentication load test failed:", error);
    }

    sleep(0.1);
  });
}

// Concurrent operations testing
export function concurrentOperationsTest(/* data */) {
  group("Concurrent Operations Test", () => {
    const concurrentStart = Date.now();

    try {
      const auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 100));
      const headers = authHelper.getAuthHeaders(auth.token);

      // Simulate concurrent operations that a user might perform
      const operations = [
        () => http.get(`${BASE_URL}/api/projects`, { headers }),
        () => http.get(`${BASE_URL}/api/auth/profile`, { headers }),
        () => http.get(`${BASE_URL}/health`, { headers }),
      ];

      // Execute operations concurrently
      const promises = operations.map((op) => op());
      const responses = promises; // In k6, requests are synchronous

      const concurrentDuration = Date.now() - concurrentStart;
      concurrentRequestsDuration.add(concurrentDuration);

      // Check all responses
      responses.forEach((response) => {
        const success = response.status >= 200 && response.status < 300;
        apiPerformanceRate.add(success);
        apiThroughput.add(1);
      });
    } catch (error) {
      apiPerformanceRate.add(false);
      console.error("Concurrent operations test failed:", error);
    }

    sleep(0.2);
  });
}

// Cache performance testing
export function cachePerformanceTest(/* data */) {
  group("Cache Performance Test", () => {
    try {
      const auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 50));
      const headers = authHelper.getAuthHeaders(auth.token);

      // Test cacheable endpoints multiple times
      const cacheableEndpoints = [
        `${BASE_URL}/api/projects`,
        `${BASE_URL}/health`,
        `${BASE_URL}/metrics`,
      ];

      cacheableEndpoints.forEach((endpoint) => {
        // First request (cache miss)
        http.get(endpoint, { headers });

        // Second request (should be cache hit)
        sleep(0.1);
        const secondResponse = http.get(endpoint, { headers });
        const isSecondCacheHit =
          secondResponse.headers["X-Cache"] === "HIT" ||
          secondResponse.headers["x-cache"] === "HIT";

        cacheEfficiency.add(isSecondCacheHit);

        const success = assertions.checkCacheHit(secondResponse, true);
        apiPerformanceRate.add(success);
        apiThroughput.add(2);

        sleep(0.2);
      });
    } catch (error) {
      apiPerformanceRate.add(false);
      console.error("Cache performance test failed:", error);
    }

    sleep(0.5);
  });
}

export function teardown(/* data */) {
  console.log("API performance test completed");

  // Final health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after comprehensive test": (r) => r.status === 200,
  });

  // Log final metrics
  console.log(`Total API requests: ${apiThroughput.count}`);
}
