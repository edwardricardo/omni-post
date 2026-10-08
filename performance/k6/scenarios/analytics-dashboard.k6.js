import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { AuthHelper, createAuthenticatedUser } from "../utils/auth-helpers.js";
import { DataGenerator } from "../utils/data-generators.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics
const analyticsQueryRate = new Rate("analytics_query_success_rate");
const dashboardLoadDuration = new Trend("dashboard_load_duration");
const complexQueryDuration = new Trend("complex_query_duration");
const aggregationQueryDuration = new Trend("aggregation_query_duration");
const exportOperationDuration = new Trend("export_operation_duration");
const cacheMissRate = new Rate("cache_miss_rate");
const analyticsQueries = new Counter("analytics_queries_total");

// Test configuration
export const options = {
  stages: [
    { duration: "30s", target: 10 }, // Warm up analytics
    { duration: "1m", target: 25 }, // Light load
    { duration: "2m", target: 50 }, // Moderate load
    { duration: "3m", target: 75 }, // Heavy analytics load
    { duration: "2m", target: 100 }, // Peak analytics load
    { duration: "3m", target: 100 }, // Sustained peak
    { duration: "1m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000", "p(99)<3000"],
    http_req_failed: ["rate<0.01"],
    analytics_query_success_rate: ["rate>0.99"],
    dashboard_load_duration: ["p(95)<800"],
    complex_query_duration: ["p(95)<2000"],
    aggregation_query_duration: ["p(95)<1500"],
    checks: ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const dataGenerator = new DataGenerator();
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up analytics dashboard performance test...");

  // Health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  // Create test data
  const testUser = createAuthenticatedUser(authHelper, 0);
  const headers = authHelper.getAuthHeaders(testUser.token);

  // Create project with sample data
  const projectData = dataGenerator.generateProject();
  const projectResponse = http.post(`${BASE_URL}/api/projects`, JSON.stringify(projectData), {
    headers,
  });

  let projectId = null;
  if (projectResponse.status === 201) {
    projectId = projectResponse.json("id");

    // Create some posts for analytics
    const posts = Array.from({ length: 10 }, () => dataGenerator.generatePostContent("text"));
    posts.forEach((post) => {
      http.post(`${BASE_URL}/api/projects/${projectId}/posts`, JSON.stringify(post), { headers });
      sleep(0.1);
    });
  }

  return {
    baseUrl: BASE_URL,
    testUser,
    projectId,
    testStartTime: new Date().toISOString(),
  };
}

export default function analyticsDashboardTest(data) {
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
    console.error("No project available for analytics testing");
    return;
  }

  group("Analytics Dashboard Performance", () => {
    // Test 1: Dashboard Overview Load
    group("Dashboard Overview", () => {
      const startTime = Date.now();

      const response = http.get(`${BASE_URL}/api/projects/${projectId}/analytics/dashboard`, {
        headers,
      });

      const duration = Date.now() - startTime;
      dashboardLoadDuration.add(duration);

      const success = assertions.checkAnalyticsQuery(response, "week");
      analyticsQueryRate.add(success);
      analyticsQueries.add(1);

      // Check cache headers
      const cacheHit =
        response.headers["X-Cache"] === "HIT" || response.headers["x-cache"] === "HIT";
      cacheMissRate.add(!cacheHit);

      sleep(0.3);
    });

    // Test 2: Time Range Analytics
    group("Time Range Analytics", () => {
      const timeRanges = ["day", "week", "month", "quarter"];

      timeRanges.forEach((range) => {
        const startTime = Date.now();

        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics?range=${range}`,
          { headers }
        );

        const duration = Date.now() - startTime;

        assertions.checkAnalyticsQuery(response, range);
        analyticsQueries.add(1);

        if (range === "month" || range === "quarter") {
          complexQueryDuration.add(duration);
        }

        sleep(0.2);
      });
    });

    // Test 3: Platform-Specific Analytics
    group("Platform Analytics", () => {
      const platforms = ["x", "instagram", "facebook", "youtube"];

      platforms.forEach((platform) => {
        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/platforms/${platform}`,
          { headers }
        );

        assertions.checkApiResponse(response, 200, {
          [`${platform} analytics loaded`]: (r) => r.status === 200,
          [`${platform} has metrics`]: (r) => r.json("metrics") !== undefined,
        });

        analyticsQueries.add(1);
        sleep(0.1);
      });
    });

    // Test 4: Complex Aggregation Queries
    group("Complex Aggregations", () => {
      const aggregations = [
        "engagement_trends",
        "audience_demographics",
        "content_performance",
        "posting_patterns",
        "growth_metrics",
      ];

      aggregations.forEach((aggregation) => {
        const startTime = Date.now();

        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/aggregations/${aggregation}?period=30d`,
          { headers }
        );

        const duration = Date.now() - startTime;
        aggregationQueryDuration.add(duration);

        assertions.checkApiResponse(response, 200, {
          [`${aggregation} aggregation successful`]: (r) => r.status === 200,
          [`${aggregation} has data`]: (r) => r.json("data") !== undefined,
        });

        analyticsQueries.add(1);
        sleep(0.3);
      });
    });

    // Test 5: Real-time Analytics
    group("Real-time Analytics", () => {
      const response = http.get(`${BASE_URL}/api/projects/${projectId}/analytics/realtime`, {
        headers,
      });

      assertions.checkApiResponse(response, 200, {
        "realtime analytics fast response": (r) => r.timings.duration < 200,
        "realtime has current data": (r) => r.json("timestamp") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.1);
    });

    // Test 6: Comparative Analytics
    group("Comparative Analytics", () => {
      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/analytics/compare?period=this_month&compare_to=last_month`,
        { headers }
      );

      assertions.checkApiResponse(response, 200, {
        "comparative analytics loaded": (r) => r.status === 200,
        "has comparison data": (r) => r.json("comparison") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.2);
    });

    // Test 7: Custom Date Range Analytics
    group("Custom Date Range", () => {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/analytics/custom?start=${startDate}&end=${endDate}`,
        { headers }
      );

      assertions.checkApiResponse(response, 200, {
        "custom range analytics loaded": (r) => r.status === 200,
        "custom range response time acceptable": (r) => r.timings.duration < 1500,
      });

      analyticsQueries.add(1);
      sleep(0.2);
    });

    // Test 8: Analytics Export
    group("Analytics Export", () => {
      const startTime = Date.now();

      const exportFormats = ["csv", "json", "pdf"];
      const format = exportFormats[Math.floor(Math.random() * exportFormats.length)];

      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/analytics/export?format=${format}&range=week`,
        { headers }
      );

      const duration = Date.now() - startTime;
      exportOperationDuration.add(duration);

      assertions.checkApiResponse(response, 200, {
        [`${format} export successful`]: (r) => r.status === 200,
        "export has content": (r) => r.body.length > 0,
      });

      analyticsQueries.add(1);
      sleep(0.5);
    });

    // Test 9: Performance Metrics Query
    group("Performance Metrics", () => {
      const response = http.get(`${BASE_URL}/api/projects/${projectId}/analytics/performance`, {
        headers,
      });

      assertions.checkApiResponse(response, 200, {
        "performance metrics loaded": (r) => r.status === 200,
        "has performance data": (r) => r.json("metrics") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.1);
    });

    // Test 10: Top Content Analytics
    group("Top Content Analytics", () => {
      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/analytics/top-content?period=week&limit=10`,
        { headers }
      );

      assertions.checkApiResponse(response, 200, {
        "top content loaded": (r) => r.status === 200,
        "has top content data": (r) => r.json("content") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.1);
    });

    // Test 11: Audience Insights
    group("Audience Insights", () => {
      const response = http.get(`${BASE_URL}/api/projects/${projectId}/analytics/audience`, {
        headers,
      });

      assertions.checkApiResponse(response, 200, {
        "audience insights loaded": (r) => r.status === 200,
        "has audience data": (r) => r.json("demographics") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.2);
    });

    // Test 12: Trending Hashtags
    group("Trending Analytics", () => {
      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/analytics/trends?type=hashtags`,
        { headers }
      );

      assertions.checkApiResponse(response, 200, {
        "trends loaded": (r) => r.status === 200,
        "has trending data": (r) => r.json("trends") !== undefined,
      });

      analyticsQueries.add(1);
      sleep(0.1);
    });

    // Test 13: Concurrent Dashboard Queries
    group("Concurrent Queries", () => {
      // Simulate loading multiple dashboard widgets simultaneously
      const promises = [
        http.asyncRequest("GET", `${BASE_URL}/api/projects/${projectId}/analytics/summary`, {
          headers,
        }),
        http.asyncRequest("GET", `${BASE_URL}/api/projects/${projectId}/analytics/engagement`, {
          headers,
        }),
        http.asyncRequest("GET", `${BASE_URL}/api/projects/${projectId}/analytics/reach`, {
          headers,
        }),
        http.asyncRequest("GET", `${BASE_URL}/api/projects/${projectId}/analytics/followers`, {
          headers,
        }),
      ];

      // Note: k6 doesn't have Promise.all, so we'll just fire these requests
      promises.forEach(() => analyticsQueries.add(1));

      sleep(0.5);
    });
  });

  // Think time between user sessions
  sleep(Math.random() * 2 + 1);
}

export function teardown(/* data */) {
  console.log("Analytics dashboard performance test completed");
  console.log(`Total analytics queries: ${analyticsQueries.count}`);

  // Final health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after analytics test": (r) => r.status === 200,
  });
}
