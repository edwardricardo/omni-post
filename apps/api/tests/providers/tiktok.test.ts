import { TikTokAdapter } from "@providers/tiktok";
import {
  ProviderTestRunner,
  TestDataFactory,
  MockCredentialsFactory,
  type ProviderTestSuite,
} from "./testFramework.js";

// TikTok specific test suite
const tiktokTestSuite: ProviderTestSuite = {
  providerId: "tiktok",
  adapter: TikTokAdapter,
  mockCredentials: MockCredentialsFactory.tiktok,

  renderTests: [
    {
      name: "Simple TikTok video",
      input: TestDataFactory.createMediaPost(
        "Quick life hack that changed everything! 🚀 Try this at home \u2728 #lifehack #tips #viral",
        ["https://example.com/lifehack.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Basic TikTok video with hashtags",
    },
    {
      name: "TikTok dance video",
      input: TestDataFactory.createMediaPost(
        "New dance trend! Who wants to try this? 💃🕺 #dance #trending #fyp #viral",
        ["https://example.com/dance.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "TikTok dance content with trending hashtags",
    },
    {
      name: "Educational TikTok",
      input: TestDataFactory.createMediaPost(
        "Did you know? Amazing science fact that will blow your mind! 🤯 Follow for more educational content \ud83d� #science #education #didyouknow #facts #learning",
        ["https://example.com/science.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Educational TikTok content",
    },
    {
      name: "TikTok with maximum description length",
      input: TestDataFactory.createMediaPost(
        "A".repeat(2200),
        ["https://example.com/max-desc.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "TikTok at maximum 2200 character description limit",
    },
    {
      name: "TikTok exceeding description limit",
      input: TestDataFactory.createMediaPost(
        "A".repeat(2300),
        ["https://example.com/too-long.mp4"],
        ["video"]
      ),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "TikTok description exceeding 2200 character limit",
    },
    {
      name: "TikTok without video",
      input: TestDataFactory.createSimplePost("Just text, no video content"),
      expectedResult: "error",
      expectedError: "MEDIA_REQUIRED",
      description: "TikTok requires video content",
    },
    {
      name: "TikTok with image instead of video",
      input: TestDataFactory.createMediaPost(
        "Trying to upload an image to TikTok",
        ["https://example.com/image.jpg"],
        ["image"]
      ),
      expectedResult: "error",
      expectedError: "INVALID_MEDIA_TYPE",
      description: "TikTok only accepts video content",
    },
    {
      name: "TikTok with multiple videos",
      input: TestDataFactory.createMediaPost(
        "Trying to upload multiple videos",
        ["https://example.com/video1.mp4", "https://example.com/video2.mp4"],
        ["video", "video"]
      ),
      expectedResult: "error",
      expectedError: "TOO_MANY_MEDIA",
      description: "TikTok only accepts one video per post",
    },
    {
      name: "Comedy TikTok",
      input: TestDataFactory.createMediaPost(
        "When you realize it's Monday tomorrow 😂😭 Anyone else? #mood #monday #relatable #comedy",
        ["https://example.com/comedy.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Comedy/relatable TikTok content",
    },
  ],

  publishTests: [
    {
      name: "Valid TikTok video publish",
      input: TestDataFactory.createMediaPost(
        "Test video for TikTok! #test #firstpost",
        ["https://example.com/test.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Publishing a valid TikTok video should work",
    },
    {
      name: "TikTok with viral hashtags",
      input: TestDataFactory.createMediaPost(
        "This is going to be huge! 🚀 #fyp #viral #trending #foryou #amazing",
        ["https://example.com/viral.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Publishing TikTok with popular hashtags",
    },
    {
      name: "Invalid TikTok content publish",
      input: TestDataFactory.createSimplePost("No video content"),
      expectedResult: "error",
      expectedError: "VALIDATION",
      description: "Publishing without video should fail",
    },
  ],

  analyticsTests: [
    {
      name: "Basic TikTok analytics",
      channelId: "test-channel-tiktok",
      expectedResult: "success",
      description: "Fetch basic TikTok user analytics",
    },
    {
      name: "TikTok analytics with date range",
      channelId: "test-channel-tiktok",
      since: new Date("2024-01-01"),
      until: new Date("2024-01-31"),
      expectedResult: "success",
      description: "Fetch TikTok analytics for specific period",
    },
  ],
};

// TikTok-specific feature tests
export async function testTikTokFeatures(): Promise<void> {
  console.log("🧪 Testing TikTok-specific features");

  // Test TikTok capabilities
  if (!TikTokAdapter.capabilities?.publish) {
    throw new Error("TikTok adapter should support publishing");
  }

  if (TikTokAdapter.capabilities?.schedule !== false) {
    throw new Error("TikTok adapter should not support scheduling (API limitation)");
  }

  if (!TikTokAdapter.capabilities?.analytics) {
    throw new Error("TikTok adapter should support analytics");
  }

  if (TikTokAdapter.capabilities?.threading !== false) {
    throw new Error("TikTok adapter should not support threading");
  }

  if (TikTokAdapter.capabilities?.comments !== false) {
    throw new Error("TikTok adapter should not support comments (API limitation)");
  }

  // Test TikTok limits
  if (TikTokAdapter.limits?.maxChars !== 2200) {
    throw new Error("TikTok adapter should have 2200 character description limit");
  }

  if (TikTokAdapter.limits?.maxMediaPerPost !== 1) {
    throw new Error("TikTok adapter should support 1 video per post");
  }

  // Test supported media types
  const supportedMedia = TikTokAdapter.limits?.allowedMedia || [];
  if (!supportedMedia.includes("video") || supportedMedia.length !== 1) {
    throw new Error("TikTok adapter should only support video content");
  }

  console.log("✅ TikTok feature tests passed");
}

// Test TikTok Content Posting API specific features
export async function testTikTokContentAPI(): Promise<void> {
  console.log("🧪 Testing TikTok Content Posting API features");

  // Test aspect ratios
  const aspectRatios = TikTokAdapter.limits?.aspectRatios || [];
  const expectedRatios = ["9:16", "1:1", "16:9"];
  for (const ratio of expectedRatios) {
    if (!aspectRatios.includes(ratio)) {
      throw new Error(`TikTok adapter should support ${ratio} aspect ratio`);
    }
  }

  // Test video duration limits (3 minutes)
  if (TikTokAdapter.limits?.maxVideoDuration !== 180) {
    throw new Error("TikTok adapter should have 180 second (3 minute) video limit");
  }

  // Test rate limiting hints
  const rateLimitHints = TikTokAdapter.limits?.rateLimitHints;
  if (!rateLimitHints || rateLimitHints.burst !== 50 || rateLimitHints.perSeconds !== 3600) {
    throw new Error("TikTok adapter should have proper rate limit hints (50 per hour)");
  }

  console.log("✅ TikTok Content API tests passed");
}

// Run TikTok provider tests
export async function runTikTokProviderTests(): Promise<void> {
  console.log("🚀 Starting TikTok provider integration tests");

  const runner = new ProviderTestRunner();

  try {
    // Run comprehensive test suite
    const results = await runner.runProviderSuite(tiktokTestSuite);

    // Run TikTok-specific feature tests
    await testTikTokFeatures();
    await testTikTokContentAPI();

    // Generate and log results
    const report = runner.generateReport([results]);
    console.log("\n" + report);

    // Check if all critical tests passed
    const totalFailed = results.overall.failed;
    if (totalFailed > 0) {
      console.warn(`⚠️  TikTok provider tests had ${totalFailed} failures`);
    } else {
      console.log("🎉 All TikTok provider tests passed!");
    }
  } catch (error) {
    console.error("❌ TikTok provider test suite failed:", error);
    throw error;
  }
}

// Export for use in main test runner
export { tiktokTestSuite };
