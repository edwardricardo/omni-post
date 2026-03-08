import { FacebookAdapter } from "@providers/facebook";
import {
  ProviderTestRunner,
  TestDataFactory,
  MockCredentialsFactory,
  type ProviderTestSuite,
} from "./testFramework.js";

// Facebook specific test suite
const facebookTestSuite: ProviderTestSuite = {
  providerId: "facebook",
  adapter: FacebookAdapter,
  mockCredentials: MockCredentialsFactory.facebook,

  renderTests: [
    {
      name: "Simple Facebook post",
      input: TestDataFactory.createSimplePost("Sharing some thoughts with my Facebook friends! 👋"),
      expectedResult: "success",
      description: "Basic Facebook post within character limits",
    },
    {
      name: "Facebook post with single image",
      input: TestDataFactory.createMediaPost(
        "Check out this amazing moment captured today!",
        ["https://example.com/moment.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Facebook post with single image",
    },
    {
      name: "Facebook post with multiple images",
      input: TestDataFactory.createMediaPost(
        "Album from today's events! So many great memories 📸",
        [
          "https://example.com/event1.jpg",
          "https://example.com/event2.jpg",
          "https://example.com/event3.jpg",
          "https://example.com/event4.jpg",
          "https://example.com/event5.jpg",
        ],
        ["image", "image", "image", "image", "image"]
      ),
      expectedResult: "success",
      description: "Facebook post with multiple images (album)",
    },
    {
      name: "Facebook post with video",
      input: TestDataFactory.createMediaPost(
        "Behind the scenes video from today's work! 🎬",
        ["https://example.com/behind-scenes.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Facebook post with video content",
    },
    {
      name: "Very long Facebook post",
      input: TestDataFactory.createLongPost(1000),
      expectedResult: "success",
      description: "Facebook supports very long posts (up to 63206 characters)",
    },
    {
      name: "Post exceeding Facebook's massive character limit",
      input: TestDataFactory.createLongPost(65000),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "Post exceeding 63206 character limit",
    },
    {
      name: "Post with too many media items",
      input: TestDataFactory.createMediaPost(
        "Way too many photos!",
        Array.from({ length: 15 }, (_, i) => `https://example.com/photo${i + 1}.jpg`),
        Array.from({ length: 15 }, () => "image")
      ),
      expectedResult: "error",
      expectedError: "TOO_MANY_MEDIA",
      description: "Post with more than 10 media items",
    },
    {
      name: "Text-only Facebook post",
      input: TestDataFactory.createSimplePost("Just sharing some thoughts today!"),
      expectedResult: "success",
      description: "Facebook allows text-only posts",
    },
  ],

  publishTests: [
    {
      name: "Valid Facebook post publish",
      input: TestDataFactory.createSimplePost("Publishing test post to Facebook!"),
      expectedResult: "success",
      description: "Publishing a valid Facebook post should work",
    },
    {
      name: "Facebook post with media publish",
      input: TestDataFactory.createMediaPost(
        "Publishing with media to Facebook",
        ["https://example.com/test.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Publishing Facebook post with media should work",
    },
    {
      name: "Facebook album publish",
      input: TestDataFactory.createMediaPost(
        "Publishing album to Facebook",
        ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        ["image", "image"]
      ),
      expectedResult: "success",
      description: "Publishing Facebook photo album should work",
    },
  ],

  analyticsTests: [
    {
      name: "Basic Facebook analytics",
      channelId: "test-channel-facebook",
      expectedResult: "success",
      description: "Fetch basic Facebook page analytics",
    },
    {
      name: "Facebook analytics with date range",
      channelId: "test-channel-facebook",
      since: new Date("2024-01-01"),
      until: new Date("2024-01-31"),
      expectedResult: "success",
      description: "Fetch Facebook analytics for specific period",
    },
  ],
};

// Facebook-specific feature tests
export async function testFacebookFeatures(): Promise<void> {
  console.log("🧪 Testing Facebook-specific features");

  // Test Facebook capabilities
  if (!FacebookAdapter.capabilities?.publish) {
    throw new Error("Facebook adapter should support publishing");
  }

  if (!FacebookAdapter.capabilities?.schedule) {
    throw new Error("Facebook adapter should support scheduling");
  }

  if (!FacebookAdapter.capabilities?.analytics) {
    throw new Error("Facebook adapter should support analytics");
  }

  if (FacebookAdapter.capabilities?.threading !== false) {
    throw new Error("Facebook adapter should not support threading");
  }

  // Test Facebook limits
  if (FacebookAdapter.limits?.maxChars !== 63206) {
    throw new Error("Facebook adapter should have 63206 character limit");
  }

  if (FacebookAdapter.limits?.maxMediaPerPost !== 10) {
    throw new Error("Facebook adapter should support 10 media per post");
  }

  console.log("✅ Facebook feature tests passed");
}

// Test Facebook Graph API v23.0 specific features
export async function testFacebookGraphAPI(): Promise<void> {
  console.log("🧪 Testing Facebook Graph API v23.0 features");

  // Test supported media types
  const supportedMedia = FacebookAdapter.limits?.allowedMedia || [];
  if (!supportedMedia.includes("image") || !supportedMedia.includes("video")) {
    throw new Error("Facebook adapter should support both image and video");
  }

  // Test aspect ratios
  const aspectRatios = FacebookAdapter.limits?.aspectRatios || [];
  const expectedRatios = ["16:9", "1:1", "4:5", "9:16"];
  for (const ratio of expectedRatios) {
    if (!aspectRatios.includes(ratio)) {
      throw new Error(`Facebook adapter should support ${ratio} aspect ratio`);
    }
  }

  // Test video duration limits
  if (FacebookAdapter.limits?.maxVideoDuration !== 240) {
    throw new Error("Facebook adapter should have 240 second (4 minute) video limit");
  }

  console.log("✅ Facebook Graph API tests passed");
}

// Run Facebook provider tests
export async function runFacebookProviderTests(): Promise<void> {
  console.log("🚀 Starting Facebook provider integration tests");

  const runner = new ProviderTestRunner();

  try {
    // Run comprehensive test suite
    const results = await runner.runProviderSuite(facebookTestSuite);

    // Run Facebook-specific feature tests
    await testFacebookFeatures();
    await testFacebookGraphAPI();

    // Generate and log results
    const report = runner.generateReport([results]);
    console.log("\n" + report);

    // Check if all critical tests passed
    const totalFailed = results.overall.failed;
    if (totalFailed > 0) {
      console.warn(`⚠️  Facebook provider tests had ${totalFailed} failures`);
    } else {
      console.log("🎉 All Facebook provider tests passed!");
    }
  } catch (error) {
    console.error("❌ Facebook provider test suite failed:", error);
    throw error;
  }
}

// Export for use in main test runner
export { facebookTestSuite };
