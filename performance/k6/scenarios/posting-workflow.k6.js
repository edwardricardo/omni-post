import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { AuthHelper, createAuthenticatedUser } from "../utils/auth-helpers.js";
import { DataGenerator } from "../utils/data-generators.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics
const postCreationRate = new Rate("post_creation_success_rate");
const postCreationDuration = new Trend("post_creation_duration");
const mediaUploadDuration = new Trend("media_upload_duration");
const schedulingDuration = new Trend("scheduling_duration");
const bulkOperationDuration = new Trend("bulk_operation_duration");
const postsCreated = new Counter("posts_created_total");
const mediaFilesUploaded = new Counter("media_files_uploaded_total");

// Test configuration
export const options = {
  stages: [
    { duration: "1m", target: 20 }, // Warm up
    { duration: "2m", target: 50 }, // Moderate load
    { duration: "3m", target: 100 }, // Target load
    { duration: "2m", target: 150 }, // High load
    { duration: "1m", target: 200 }, // Peak load
    { duration: "3m", target: 200 }, // Sustained peak
    { duration: "2m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.02"],
    post_creation_success_rate: ["rate>0.98"],
    post_creation_duration: ["p(95)<300"],
    media_upload_duration: ["p(95)<2000"],
    scheduling_duration: ["p(95)<200"],
    checks: ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const dataGenerator = new DataGenerator();
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up posting workflow performance test...");

  // Health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  // Create test project and channels
  const testUser = createAuthenticatedUser(authHelper, 0);
  const headers = authHelper.getAuthHeaders(testUser.token);

  // Create test project
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

export default function postingWorkflowTest(data) {
  const userIndex = Math.floor(Math.random() * 1000);
  let auth;

  try {
    auth = createAuthenticatedUser(authHelper, userIndex);
  } catch (error) {
    console.error("Authentication failed:", error);
    return;
  }

  const headers = authHelper.getAuthHeaders(auth.token);

  group("Posting Workflow Performance", () => {
    let projectId = data.projectId;

    // Create project if not available from setup
    if (!projectId) {
      group("Project Creation", () => {
        const projectData = dataGenerator.generateProject();
        const response = http.post(`${BASE_URL}/api/projects`, JSON.stringify(projectData), {
          headers,
        });

        assertions.checkApiResponse(response, 201, {
          "project creation has id": (r) => r.json("id") !== undefined,
        });

        if (response.status === 201) {
          projectId = response.json("id");
        }
      });
    }

    if (!projectId) {
      console.error("Could not create/access project");
      return;
    }

    // Test 1: Channel Management
    group("Channel Management", () => {
      const platforms = ["x", "instagram", "facebook"];
      const channelIds = [];

      platforms.forEach((platform) => {
        const channelData = dataGenerator.generateChannel(platform);
        const response = http.post(
          `${BASE_URL}/api/projects/${projectId}/channels`,
          JSON.stringify(channelData),
          { headers }
        );

        assertions.checkApiResponse(response, 201, {
          [`${platform} channel created`]: (r) => r.json("id") !== undefined,
        });

        if (response.status === 201) {
          channelIds.push(response.json("id"));
        }

        sleep(0.1);
      });
    });

    // Test 2: Simple Post Creation
    group("Simple Post Creation", () => {
      const startTime = Date.now();

      const postData = dataGenerator.generatePostContent("text");
      const response = http.post(
        `${BASE_URL}/api/projects/${projectId}/posts`,
        JSON.stringify(postData),
        { headers }
      );

      const duration = Date.now() - startTime;
      postCreationDuration.add(duration);

      if (
        assertions.checkApiResponse(response, 201, {
          "post creation has id": (r) => r.json("id") !== undefined,
          "post creation response time < 300ms": (r) => r.timings.duration < 300,
        })
      ) {
        postCreationRate.add(true);
        postsCreated.add(1);
      } else {
        postCreationRate.add(false);
      }

      sleep(0.2);
    });

    // Test 3: Media Upload and Post Creation
    group("Media Post Creation", () => {
      const startTime = Date.now();

      // Simulate image upload
      const imageData = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD..."; // Base64 image
      const uploadResponse = http.post(
        `${BASE_URL}/api/projects/${projectId}/media`,
        JSON.stringify({
          filename: "test-image.jpg",
          mimeType: "image/jpeg",
          data: imageData,
        }),
        { headers }
      );

      const uploadDuration = Date.now() - startTime;
      mediaUploadDuration.add(uploadDuration);

      if (uploadResponse.status === 201) {
        mediaFilesUploaded.add(1);
        const mediaId = uploadResponse.json("id");

        // Create post with media
        const postData = {
          ...dataGenerator.generatePostContent("image"),
          mediaIds: [mediaId],
        };

        const postResponse = http.post(
          `${BASE_URL}/api/projects/${projectId}/posts`,
          JSON.stringify(postData),
          { headers }
        );

        assertions.checkApiResponse(postResponse, 201, {
          "media post created": (r) => r.json("id") !== undefined,
        });

        if (postResponse.status === 201) {
          postsCreated.add(1);
        }
      }

      sleep(0.3);
    });

    // Test 4: Post Scheduling
    group("Post Scheduling", () => {
      const startTime = Date.now();

      const postData = {
        ...dataGenerator.generatePostContent("text"),
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      };

      const response = http.post(
        `${BASE_URL}/api/projects/${projectId}/posts`,
        JSON.stringify(postData),
        { headers }
      );

      const duration = Date.now() - startTime;
      schedulingDuration.add(duration);

      assertions.checkApiResponse(response, 201, {
        "scheduled post created": (r) => r.json("id") !== undefined,
        "scheduled post has scheduled date": (r) => r.json("scheduledAt") !== undefined,
      });

      if (response.status === 201) {
        postsCreated.add(1);
      }

      sleep(0.2);
    });

    // Test 5: Bulk Post Creation
    group("Bulk Post Creation", () => {
      const startTime = Date.now();

      const bulkPosts = Array.from({ length: 5 }, () => dataGenerator.generatePostContent("text"));

      const response = http.post(
        `${BASE_URL}/api/projects/${projectId}/posts/bulk`,
        JSON.stringify({ posts: bulkPosts }),
        { headers }
      );

      const duration = Date.now() - startTime;
      bulkOperationDuration.add(duration);

      assertions.checkBulkOperation(response, bulkPosts.length);

      if (response.status === 200) {
        postsCreated.add(bulkPosts.length);
      }

      sleep(0.5);
    });

    // Test 6: Post Retrieval and Pagination
    group("Post Retrieval", () => {
      // Get posts with pagination
      const response = http.get(`${BASE_URL}/api/projects/${projectId}/posts?limit=20&offset=0`, {
        headers,
      });

      assertions.checkPagination(response, 20);

      sleep(0.1);
    });

    // Test 7: Post Search
    group("Post Search", () => {
      const searchQuery = "test";
      const response = http.get(
        `${BASE_URL}/api/projects/${projectId}/posts/search?q=${searchQuery}`,
        { headers }
      );

      assertions.checkApiResponse(response, 200, {
        "search results returned": (r) => r.json("results") !== undefined,
        "search response time < 300ms": (r) => r.timings.duration < 300,
      });

      sleep(0.1);
    });

    // Test 8: Post Update
    group("Post Update", () => {
      // First, get a post to update
      const getResponse = http.get(`${BASE_URL}/api/projects/${projectId}/posts?limit=1`, {
        headers,
      });

      if (getResponse.status === 200 && getResponse.json("data").length > 0) {
        const postId = getResponse.json("data")[0].id;
        const updateData = {
          content: "Updated content for performance test",
        };

        const updateResponse = http.put(
          `${BASE_URL}/api/projects/${projectId}/posts/${postId}`,
          JSON.stringify(updateData),
          { headers }
        );

        assertions.checkApiResponse(updateResponse, 200, {
          "post updated successfully": (r) => r.status === 200,
          "update response time < 200ms": (r) => r.timings.duration < 200,
        });
      }

      sleep(0.1);
    });

    // Test 9: Post Publishing Simulation
    group("Post Publishing", () => {
      // Create a post to publish
      const postData = dataGenerator.generatePostContent("text");
      const createResponse = http.post(
        `${BASE_URL}/api/projects/${projectId}/posts`,
        JSON.stringify(postData),
        { headers }
      );

      if (createResponse.status === 201) {
        const postId = createResponse.json("id");

        // Simulate publishing
        const publishResponse = http.post(
          `${BASE_URL}/api/projects/${projectId}/posts/${postId}/publish`,
          JSON.stringify({ platforms: ["x"] }),
          { headers }
        );

        assertions.checkApiResponse(publishResponse, 200, {
          "publish initiated": (r) => r.status === 200,
        });
      }

      sleep(0.2);
    });

    // Test 10: Draft Management
    group("Draft Management", () => {
      // Create draft
      const draftData = {
        ...dataGenerator.generatePostContent("text"),
        status: "DRAFT",
      };

      const response = http.post(
        `${BASE_URL}/api/projects/${projectId}/posts`,
        JSON.stringify(draftData),
        { headers }
      );

      assertions.checkApiResponse(response, 201, {
        "draft created": (r) => r.json("status") === "DRAFT",
      });

      sleep(0.1);
    });
  });

  // Think time between user sessions
  sleep(Math.random() * 3 + 1);
}

export function teardown(/* data */) {
  console.log("Posting workflow performance test completed");
  console.log(`Posts created: ${postsCreated.count}`);
  console.log(`Media files uploaded: ${mediaFilesUploaded.count}`);

  // Final health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after posting test": (r) => r.status === 200,
  });
}
