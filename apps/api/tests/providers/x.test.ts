import { XAdapter } from "@providers/x";
import {
  ProviderTestRunner,
  TestDataFactory,
  MockCredentialsFactory,
  type ProviderTestSuite,
} from "./testFramework.js";

// X/Twitter specific test suite
const xTestSuite: ProviderTestSuite = {
  providerId: "x",
  adapter: XAdapter,
  mockCredentials: MockCredentialsFactory.x,

  renderTests: [
    {
      name: "Simple tweet",
      input: TestDataFactory.createSimplePost("Hello Twitter! This is a test tweet."),
      expectedResult: "success",
      description: "Basic tweet within character limits",
    },
    {
      name: "Tweet with image",
      input: TestDataFactory.createMediaPost(
        "Check out this amazing photo!",
        ["https://example.com/image.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Tweet with single image attachment",
    },
    {
      name: "Tweet with multiple images",
      input: TestDataFactory.createMediaPost(
        "Photo gallery time!",
        [
          "https://example.com/image1.jpg",
          "https://example.com/image2.jpg",
          "https://example.com/image3.jpg",
          "https://example.com/image4.jpg",
        ],
        ["image", "image", "image", "image"]
      ),
      expectedResult: "success",
      description: "Tweet with maximum 4 images",
    },
    {
      name: "Tweet with video",
      input: TestDataFactory.createMediaPost(
        "Watch this amazing video!",
        ["https://example.com/video.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Tweet with video attachment",
    },
    {
      name: "Tweet exceeding character limit",
      input: TestDataFactory.createLongPost(300),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "Tweet that exceeds 280 character limit",
    },
    {
      name: "Tweet with too many media",
      input: TestDataFactory.createMediaPost(
        "Too many images!",
        [
          "https://example.com/1.jpg",
          "https://example.com/2.jpg",
          "https://example.com/3.jpg",
          "https://example.com/4.jpg",
          "https://example.com/5.jpg",
        ],
        ["image", "image", "image", "image", "image"]
      ),
      expectedResult: "error",
      expectedError: "TOO_MANY_MEDIA",
      description: "Tweet with more than 4 media attachments",
    },
    {
      name: "Empty tweet",
      input: TestDataFactory.createEmptyPost(),
      expectedResult: "error",
      expectedError: "CONTENT_REQUIRED",
      description: "Tweet with no content",
    },
    {
      name: "Thread-style long content",
      input: TestDataFactory.createLongPost(600),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "Content that would need threading (should be handled by renderer)",
    },
  ],

  publishTests: [
    {
      name: "Valid tweet publish",
      input: TestDataFactory.createSimplePost("Test tweet for publishing"),
      expectedResult: "success",
      description: "Publishing a valid tweet should work with proper credentials",
    },
    {
      name: "Tweet with media publish",
      input: TestDataFactory.createMediaPost(
        "Publishing with media",
        ["https://example.com/test.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Publishing tweet with media should work",
    },
    {
      name: "Invalid content publish",
      input: TestDataFactory.createLongPost(300),
      expectedResult: "error",
      expectedError: "VALIDATION",
      description: "Publishing invalid content should fail",
    },
  ],

  analyticsTests: [
    {
      name: "Basic analytics fetch",
      channelId: "test-channel-x",
      expectedResult: "success",
      description: "Fetch basic analytics for X account",
    },
    {
      name: "Analytics with date range",
      channelId: "test-channel-x",
      since: new Date("2024-01-01"),
      until: new Date("2024-01-31"),
      expectedResult: "success",
      description: "Fetch analytics for specific date range",
    },
    {
      name: "Analytics for invalid channel",
      channelId: "",
      expectedResult: "error",
      description: "Analytics fetch should fail for invalid channel",
    },
  ],
};

// Additional X-specific tests for threading capability
export async function testXThreading(): Promise<void> {
  console.log("🧪 Testing X/Twitter threading capability");

  // Test that X adapter supports threading
  if (!XAdapter.capabilities?.threading) {
    throw new Error("X adapter should support threading");
  }

  // Test thread limits
  if (XAdapter.limits?.maxPostsPerThread !== 25) {
    throw new Error("X adapter should support 25 posts per thread");
  }

  console.log("✅ X threading tests passed");
}

// Test X API v2 specific features
export async function testXApiV2Features(): Promise<void> {
  console.log("🧪 Testing X API v2 specific features");

  // Test character limits
  if (XAdapter.limits?.maxChars !== 280) {
    throw new Error("X adapter should have 280 character limit");
  }

  // Test media limits
  if (XAdapter.limits?.maxMediaPerPost !== 4) {
    throw new Error("X adapter should support 4 media per post");
  }

  // Test supported media types
  const supportedMedia = XAdapter.limits?.allowedMedia || [];
  const expectedMedia = ["image", "video", "gif"];
  for (const mediaType of expectedMedia) {
    if (!supportedMedia.includes(mediaType)) {
      throw new Error(`X adapter should support ${mediaType} media`);
    }
  }

  console.log("✅ X API v2 feature tests passed");
}

// Run X provider tests
export async function runXProviderTests(): Promise<void> {
  console.log("🚀 Starting X/Twitter provider integration tests");

  const runner = new ProviderTestRunner();

  try {
    // Run comprehensive test suite
    const results = await runner.runProviderSuite(xTestSuite);

    // Run X-specific feature tests
    await testXThreading();
    await testXApiV2Features();

    // Generate and log results
    const report = runner.generateReport([results]);
    console.log("\n" + report);

    // Check if all critical tests passed
    const totalFailed = results.overall.failed;
    if (totalFailed > 0) {
      console.warn(`⚠️  X provider tests had ${totalFailed} failures`);
    } else {
      console.log("🎉 All X provider tests passed!");
    }
  } catch (error) {
    console.error("❌ X provider test suite failed:", error);
    throw error;
  }
}

// Export for use in main test runner
export { xTestSuite };
