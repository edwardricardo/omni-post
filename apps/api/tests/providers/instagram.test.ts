import { InstagramAdapter } from "@providers/instagram";
import {
  ProviderTestRunner,
  TestDataFactory,
  MockCredentialsFactory,
  type ProviderTestSuite,
} from "./testFramework.js";

// Instagram specific test suite
const instagramTestSuite: ProviderTestSuite = {
  providerId: "instagram",
  adapter: InstagramAdapter,
  mockCredentials: MockCredentialsFactory.instagram,

  renderTests: [
    {
      name: "Simple Instagram post",
      input: TestDataFactory.createSimplePost("Beautiful sunset today! 🌅 #photography #nature"),
      expectedResult: "success",
      description: "Basic Instagram post within character limits",
    },
    {
      name: "Instagram post with single image",
      input: TestDataFactory.createMediaPost(
        "Check out this amazing landscape! #travel #adventure",
        ["https://example.com/landscape.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Instagram post with single image",
    },
    {
      name: "Instagram carousel post",
      input: TestDataFactory.createMediaPost(
        "Photo series from my latest trip! Swipe to see more 📸",
        [
          "https://example.com/photo1.jpg",
          "https://example.com/photo2.jpg",
          "https://example.com/photo3.jpg",
          "https://example.com/photo4.jpg",
          "https://example.com/photo5.jpg",
        ],
        ["image", "image", "image", "image", "image"]
      ),
      expectedResult: "success",
      description: "Instagram carousel with multiple images",
    },
    {
      name: "Instagram Reel",
      input: TestDataFactory.createMediaPost(
        "Quick tutorial on photography tips! 🎥 #reels #photography",
        ["https://example.com/reel.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Instagram Reel video content",
    },
    {
      name: "Post exceeding character limit",
      input: TestDataFactory.createLongPost(2300),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "Post exceeding 2200 character limit",
    },
    {
      name: "Post with too many media items",
      input: TestDataFactory.createMediaPost(
        "Too many photos in this carousel!",
        Array.from({ length: 25 }, (_, i) => `https://example.com/photo${i + 1}.jpg`),
        Array.from({ length: 25 }, () => "image")
      ),
      expectedResult: "error",
      expectedError: "TOO_MANY_MEDIA",
      description: "Carousel with more than 20 media items",
    },
    {
      name: "Post without media",
      input: TestDataFactory.createSimplePost("Text-only post for Instagram"),
      expectedResult: "error",
      expectedError: "MEDIA_REQUIRED",
      description: "Instagram requires media for posts",
    },
    {
      name: "Mixed media types",
      input: TestDataFactory.createMediaPost(
        "Mixed content post",
        ["https://example.com/photo.jpg", "https://example.com/video.mp4"],
        ["image", "video"]
      ),
      expectedResult: "error",
      expectedError: "INVALID_MEDIA_MIX",
      description: "Instagram doesn't allow mixing images and videos",
    },
  ],

  publishTests: [
    {
      name: "Valid Instagram post publish",
      input: TestDataFactory.createMediaPost(
        "Publishing test post! #test",
        ["https://example.com/test.jpg"],
        ["image"]
      ),
      expectedResult: "success",
      description: "Publishing a valid Instagram post should work",
    },
    {
      name: "Instagram carousel publish",
      input: TestDataFactory.createMediaPost(
        "Carousel test post",
        ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        ["image", "image"]
      ),
      expectedResult: "success",
      description: "Publishing Instagram carousel should work",
    },
    {
      name: "Invalid content publish",
      input: TestDataFactory.createSimplePost("No media post"),
      expectedResult: "error",
      expectedError: "VALIDATION",
      description: "Publishing without media should fail",
    },
  ],

  analyticsTests: [
    {
      name: "Basic Instagram analytics",
      channelId: "test-channel-instagram",
      expectedResult: "success",
      description: "Fetch basic Instagram analytics",
    },
    {
      name: "Instagram analytics with date range",
      channelId: "test-channel-instagram",
      since: new Date("2024-01-01"),
      until: new Date("2024-01-31"),
      expectedResult: "success",
      description: "Fetch Instagram analytics for specific period",
    },
  ],
};

// Instagram-specific feature tests
export async function testInstagramFeatures(): Promise<void> {
  console.log("🧪 Testing Instagram-specific features");

  // Test Instagram capabilities
  if (!InstagramAdapter.capabilities?.publish) {
    throw new Error("Instagram adapter should support publishing");
  }

  if (InstagramAdapter.capabilities?.schedule !== false) {
    throw new Error("Instagram adapter should not support scheduling via Graph API");
  }

  if (!InstagramAdapter.capabilities?.analytics) {
    throw new Error("Instagram adapter should support analytics");
  }

  // Test Instagram limits
  if (InstagramAdapter.limits?.maxChars !== 2200) {
    throw new Error("Instagram adapter should have 2200 character limit");
  }

  if (InstagramAdapter.limits?.maxMediaPerPost !== 20) {
    throw new Error("Instagram adapter should support 20 media per carousel");
  }

  // Test supported media types
  const supportedMedia = InstagramAdapter.limits?.allowedMedia || [];
  if (!supportedMedia.includes("image") || !supportedMedia.includes("video")) {
    throw new Error("Instagram adapter should support both image and video");
  }

  console.log("✅ Instagram feature tests passed");
}

// Test Instagram Graph API v23.0 specific features
export async function testInstagramGraphAPI(): Promise<void> {
  console.log("🧪 Testing Instagram Graph API v23.0 features");

  // Test aspect ratios
  const aspectRatios = InstagramAdapter.limits?.aspectRatios || [];
  const expectedRatios = ["1:1", "4:5", "9:16", "16:9"];
  for (const ratio of expectedRatios) {
    if (!aspectRatios.includes(ratio)) {
      throw new Error(`Instagram adapter should support ${ratio} aspect ratio`);
    }
  }

  // Test video duration limits
  if (InstagramAdapter.limits?.maxVideoDuration !== 90) {
    throw new Error("Instagram adapter should have 90 second video limit");
  }

  console.log("✅ Instagram Graph API tests passed");
}

// Run Instagram provider tests
export async function runInstagramProviderTests(): Promise<void> {
  console.log("🚀 Starting Instagram provider integration tests");

  const runner = new ProviderTestRunner();

  try {
    // Run comprehensive test suite
    const results = await runner.runProviderSuite(instagramTestSuite);

    // Run Instagram-specific feature tests
    await testInstagramFeatures();
    await testInstagramGraphAPI();

    // Generate and log results
    const report = runner.generateReport([results]);
    console.log("\n" + report);

    // Check if all critical tests passed
    const totalFailed = results.overall.failed;
    if (totalFailed > 0) {
      console.warn(`⚠️  Instagram provider tests had ${totalFailed} failures`);
    } else {
      console.log("🎉 All Instagram provider tests passed!");
    }
  } catch (error) {
    console.error("❌ Instagram provider test suite failed:", error);
    throw error;
  }
}

// Export for use in main test runner
export { instagramTestSuite };
