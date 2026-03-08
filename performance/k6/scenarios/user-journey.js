import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { AuthHelper, createAuthenticatedUser } from "../utils/auth-helpers.js";
import { DataGenerator } from "../utils/data-generators.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics
const journeyCompletionRate = new Rate("journey_completion_rate");
const journeyDuration = new Trend("journey_duration");
const userActionDuration = new Trend("user_action_duration");
// const errorRecoveryTime = new Trend('error_recovery_time'); // Reserved for future error tracking
const userSessions = new Counter("user_sessions_total");
const completedJourneys = new Counter("completed_journeys_total");

// Test configuration
export const options = {
  scenarios: {
    content_creator_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "1m", target: 0 },
      ],
      exec: "contentCreatorJourney",
    },
    social_manager_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "2m", target: 25 },
        { duration: "3m", target: 25 },
        { duration: "1m", target: 0 },
      ],
      exec: "socialManagerJourney",
    },
    analyst_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "2m", target: 15 },
        { duration: "3m", target: 15 },
        { duration: "1m", target: 0 },
      ],
      exec: "analystJourney",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    http_req_failed: ["rate<0.02"],
    journey_completion_rate: ["rate>0.95"],
    journey_duration: ["p(95)<120000"], // 2 minutes
    user_action_duration: ["p(95)<500"],
    checks: ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const dataGenerator = new DataGenerator();
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up user journey performance tests...");

  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  return {
    baseUrl: BASE_URL,
    testStartTime: new Date().toISOString(),
  };
}

// Content Creator Journey: Login → Create Project → Add Channels → Create Post → Schedule → View Analytics
export function contentCreatorJourney(/* data */) {
  const journeyStartTime = Date.now();
  userSessions.add(1);

  group("Content Creator Journey", () => {
    let auth,
      projectId,
      channelIds = [],
      postIds = [];

    try {
      // Step 1: Authentication
      group("1. Login", () => {
        const actionStart = Date.now();
        auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 1000));
        userActionDuration.add(Date.now() - actionStart);

        check(auth, {
          "login successful": (a) => a.token !== undefined,
        });

        sleep(1); // Think time
      });

      if (!auth) throw new Error("Authentication failed");

      const headers = authHelper.getAuthHeaders(auth.token);

      // Step 2: Create Project
      group("2. Create Project", () => {
        const actionStart = Date.now();
        const projectData = dataGenerator.generateProject();

        const response = http.post(`${BASE_URL}/api/projects`, JSON.stringify(projectData), {
          headers,
        });

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkApiResponse(response, 201, {
          "project created successfully": (r) => r.json("id") !== undefined,
        });

        if (response.status === 201) {
          projectId = response.json("id");
        }

        sleep(2); // Think time
      });

      if (!projectId) throw new Error("Project creation failed");

      // Step 3: Add Social Media Channels
      group("3. Connect Social Channels", () => {
        const platforms = ["x", "instagram", "facebook"];

        platforms.forEach((platform) => {
          const actionStart = Date.now();
          const channelData = dataGenerator.generateChannel(platform);

          const response = http.post(
            `${BASE_URL}/api/projects/${projectId}/channels`,
            JSON.stringify(channelData),
            { headers }
          );

          userActionDuration.add(Date.now() - actionStart);

          if (response.status === 201) {
            channelIds.push(response.json("id"));
          }

          sleep(0.5);
        });

        check(channelIds, {
          "channels connected": (ids) => ids.length >= 2,
        });

        sleep(1);
      });

      // Step 4: Create Content
      group("4. Create Posts", () => {
        const postTypes = ["text", "image", "text"];

        postTypes.forEach((type) => {
          const actionStart = Date.now();
          const postData = dataGenerator.generatePostContent(type);

          const response = http.post(
            `${BASE_URL}/api/projects/${projectId}/posts`,
            JSON.stringify(postData),
            { headers }
          );

          userActionDuration.add(Date.now() - actionStart);

          if (response.status === 201) {
            postIds.push(response.json("id"));
          }

          sleep(1); // Think time between posts
        });

        check(postIds, {
          "posts created": (ids) => ids.length >= 2,
        });

        sleep(2);
      });

      // Step 5: Schedule Posts
      group("5. Schedule Posts", () => {
        if (postIds.length > 0) {
          const postId = postIds[0];
          const actionStart = Date.now();

          const scheduleData = {
            scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            platforms: ["x", "instagram"],
          };

          const response = http.put(
            `${BASE_URL}/api/projects/${projectId}/posts/${postId}`,
            JSON.stringify(scheduleData),
            { headers }
          );

          userActionDuration.add(Date.now() - actionStart);

          assertions.checkApiResponse(response, 200, {
            "post scheduled": (r) => r.status === 200,
          });
        }

        sleep(1);
      });

      // Step 6: View Analytics
      group("6. Check Analytics", () => {
        const actionStart = Date.now();

        const response = http.get(`${BASE_URL}/api/projects/${projectId}/analytics/dashboard`, {
          headers,
        });

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkAnalyticsQuery(response, "week");

        sleep(2);
      });

      // Journey completed successfully
      const journeyDuration_ = Date.now() - journeyStartTime;
      journeyDuration.add(journeyDuration_);
      journeyCompletionRate.add(true);
      completedJourneys.add(1);
    } catch (error) {
      console.error("Content Creator Journey failed:", error);
      journeyCompletionRate.add(false);
    }
  });

  sleep(Math.random() * 3 + 1); // Random think time
}

// Social Manager Journey: Login → Dashboard → Bulk Schedule → Team Collaboration → Reports
export function socialManagerJourney(/* data */) {
  const journeyStartTime = Date.now();
  userSessions.add(1);

  group("Social Manager Journey", () => {
    let auth, projectId;

    try {
      // Step 1: Authentication
      group("1. Manager Login", () => {
        const actionStart = Date.now();
        auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 1000));
        userActionDuration.add(Date.now() - actionStart);
        sleep(1);
      });

      if (!auth) throw new Error("Authentication failed");

      const headers = authHelper.getAuthHeaders(auth.token);

      // Step 2: Dashboard Overview
      group("2. Dashboard Overview", () => {
        const actionStart = Date.now();

        // Get projects
        const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });

        if (projectsResponse.status === 200 && projectsResponse.json("data").length > 0) {
          projectId = projectsResponse.json("data")[0].id;
        } else {
          // Create project if none exists
          const projectData = dataGenerator.generateProject();
          const createResponse = http.post(
            `${BASE_URL}/api/projects`,
            JSON.stringify(projectData),
            { headers }
          );
          if (createResponse.status === 201) {
            projectId = createResponse.json("id");
          }
        }

        userActionDuration.add(Date.now() - actionStart);
        sleep(2);
      });

      if (!projectId) throw new Error("No project available");

      // Step 3: Bulk Content Operations
      group("3. Bulk Operations", () => {
        const actionStart = Date.now();

        const bulkPosts = Array.from({ length: 10 }, () =>
          dataGenerator.generatePostContent("text")
        );

        const response = http.post(
          `${BASE_URL}/api/projects/${projectId}/posts/bulk`,
          JSON.stringify({ posts: bulkPosts }),
          { headers }
        );

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkBulkOperation(response, bulkPosts.length);
        sleep(3);
      });

      // Step 4: Schedule Management
      group("4. Schedule Management", () => {
        const actionStart = Date.now();

        const response = http.get(`${BASE_URL}/api/projects/${projectId}/posts?status=SCHEDULED`, {
          headers,
        });

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkApiResponse(response, 200, {
          "scheduled posts loaded": (r) => r.status === 200,
        });

        sleep(1);
      });

      // Step 5: Team Collaboration
      group("5. Team Features", () => {
        const actionStart = Date.now();

        // Check team members
        http.get(`${BASE_URL}/api/projects/${projectId}/team`, { headers });

        userActionDuration.add(Date.now() - actionStart);
        sleep(1);
      });

      // Step 6: Generate Reports
      group("6. Generate Reports", () => {
        const actionStart = Date.now();

        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/export?format=csv&range=month`,
          { headers }
        );

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkApiResponse(response, 200, {
          "report generated": (r) => r.status === 200,
        });

        sleep(2);
      });

      // Journey completed
      const journeyDuration_ = Date.now() - journeyStartTime;
      journeyDuration.add(journeyDuration_);
      journeyCompletionRate.add(true);
      completedJourneys.add(1);
    } catch (error) {
      console.error("Social Manager Journey failed:", error);
      journeyCompletionRate.add(false);
    }
  });

  sleep(Math.random() * 4 + 2);
}

// Analyst Journey: Login → Analytics Dashboard → Custom Reports → Data Export
export function analystJourney(/* data */) {
  const journeyStartTime = Date.now();
  userSessions.add(1);

  group("Analyst Journey", () => {
    let auth, projectId;

    try {
      // Step 1: Authentication
      group("1. Analyst Login", () => {
        const actionStart = Date.now();
        auth = createAuthenticatedUser(authHelper, Math.floor(Math.random() * 1000));
        userActionDuration.add(Date.now() - actionStart);
        sleep(1);
      });

      if (!auth) throw new Error("Authentication failed");

      const headers = authHelper.getAuthHeaders(auth.token);

      // Step 2: Access Projects
      group("2. Project Access", () => {
        const actionStart = Date.now();

        const projectsResponse = http.get(`${BASE_URL}/api/projects`, { headers });

        if (projectsResponse.status === 200 && projectsResponse.json("data").length > 0) {
          projectId = projectsResponse.json("data")[0].id;
        }

        userActionDuration.add(Date.now() - actionStart);
        sleep(1);
      });

      if (!projectId) {
        console.warn("No project available for analyst journey");
        return;
      }

      // Step 3: Analytics Dashboard
      group("3. Analytics Dashboard", () => {
        const actionStart = Date.now();

        // Load multiple analytics endpoints
        http.get(`${BASE_URL}/api/projects/${projectId}/analytics/dashboard`, { headers });
        http.get(`${BASE_URL}/api/projects/${projectId}/analytics/engagement`, { headers });
        http.get(`${BASE_URL}/api/projects/${projectId}/analytics/reach`, { headers });

        userActionDuration.add(Date.now() - actionStart);
        sleep(3);
      });

      // Step 4: Custom Date Range Analysis
      group("4. Custom Analysis", () => {
        const actionStart = Date.now();

        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = new Date().toISOString();

        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/custom?start=${startDate}&end=${endDate}`,
          { headers }
        );

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkAnalyticsQuery(response, "month");
        sleep(2);
      });

      // Step 5: Comparative Analysis
      group("5. Comparative Analysis", () => {
        const actionStart = Date.now();

        http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/compare?period=this_month&compare_to=last_month`,
          { headers }
        );

        userActionDuration.add(Date.now() - actionStart);
        sleep(2);
      });

      // Step 6: Data Export
      group("6. Data Export", () => {
        const actionStart = Date.now();

        const formats = ["csv", "json", "pdf"];
        const format = formats[Math.floor(Math.random() * formats.length)];

        const response = http.get(
          `${BASE_URL}/api/projects/${projectId}/analytics/export?format=${format}&range=quarter`,
          { headers }
        );

        userActionDuration.add(Date.now() - actionStart);

        assertions.checkApiResponse(response, 200, {
          "data exported": (r) => r.status === 200,
        });

        sleep(1);
      });

      // Journey completed
      const journeyDuration_ = Date.now() - journeyStartTime;
      journeyDuration.add(journeyDuration_);
      journeyCompletionRate.add(true);
      completedJourneys.add(1);
    } catch (error) {
      console.error("Analyst Journey failed:", error);
      journeyCompletionRate.add(false);
    }
  });

  sleep(Math.random() * 2 + 1);
}

export function teardown(/* data */) {
  console.log("User journey performance tests completed");
  console.log(`Total user sessions: ${userSessions.count}`);
  console.log(`Completed journeys: ${completedJourneys.count}`);

  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after journey tests": (r) => r.status === 200,
  });
}
