import { YouTubeAdapter } from "@providers/youtube";
import {
  ProviderTestRunner,
  TestDataFactory,
  MockCredentialsFactory,
  type ProviderTestSuite,
} from "./testFramework.js";

// YouTube specific test suite
const youtubeTestSuite: ProviderTestSuite = {
  providerId: "youtube",
  adapter: YouTubeAdapter,
  mockCredentials: MockCredentialsFactory.youtube,

  renderTests: [
    {
      name: "Simple YouTube video",
      input: TestDataFactory.createMediaPost(
        "My latest tutorial on web development! Hope you find it helpful 🎥\n\nIn this video, I cover:\n- Setting up a development environment\n- Basic HTML structure\n- CSS styling tips\n\n#webdevelopment #tutorial #coding",
        ["https://example.com/tutorial.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Basic YouTube video upload with description",
    },
    {
      name: "YouTube video with long description",
      input: TestDataFactory.createMediaPost(
        "A".repeat(4000) + "\n\nThanks for watching!",
        ["https://example.com/long-video.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "YouTube video with long but valid description",
    },
    {
      name: "YouTube video with maximum description length",
      input: TestDataFactory.createMediaPost(
        "A".repeat(5000),
        ["https://example.com/max-desc.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "YouTube video at maximum 5000 character description limit",
    },
    {
      name: "YouTube video exceeding description limit",
      input: TestDataFactory.createMediaPost(
        "A".repeat(5100),
        ["https://example.com/too-long.mp4"],
        ["video"]
      ),
      expectedResult: "error",
      expectedError: "CONTENT_TOO_LONG",
      description: "Video description exceeding 5000 character limit",
    },
    {
      name: "YouTube upload without video",
      input: TestDataFactory.createSimplePost("Just text, no video content"),
      expectedResult: "error",
      expectedError: "MEDIA_REQUIRED",
      description: "YouTube requires video content",
    },
    {
      name: "YouTube upload with image instead of video",
      input: TestDataFactory.createMediaPost(
        "Trying to upload an image to YouTube",
        ["https://example.com/image.jpg"],
        ["image"]
      ),
      expectedResult: "error",
      expectedError: "INVALID_MEDIA_TYPE",
      description: "YouTube only accepts video content",
    },
    {
      name: "YouTube upload with multiple videos",
      input: TestDataFactory.createMediaPost(
        "Trying to upload multiple videos",
        ["https://example.com/video1.mp4", "https://example.com/video2.mp4"],
        ["video", "video"]
      ),
      expectedResult: "error",
      expectedError: "TOO_MANY_MEDIA",
      description: "YouTube only accepts one video per upload",
    },
    {
      name: "YouTube Shorts video",
      input: TestDataFactory.createMediaPost(
        "Quick tip for developers! #shorts #coding #tips",
        ["https://example.com/shorts.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "YouTube Shorts (vertical) video upload",
    },
  ],

  publishTests: [
    {
      name: "Valid YouTube video publish",
      input: TestDataFactory.createMediaPost(
        "Test video upload to YouTube!",
        ["https://example.com/test.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Publishing a valid YouTube video should work",
    },
    {
      name: "YouTube video with detailed metadata",
      input: TestDataFactory.createMediaPost(
        "Complete Tutorial: Building a REST API\n\nIn this comprehensive tutorial, I'll show you how to build a REST API from scratch using Node.js and Express.\n\nTopics covered:\n- Setting up the project\n- Creating routes\n- Database integration\n- Authentication\n- Testing\n\n#nodejs #api #tutorial #programming",
        ["https://example.com/api-tutorial.mp4"],
        ["video"]
      ),
      expectedResult: "success",
      description: "Publishing YouTube video with rich metadata",
    },
    {
      name: "Invalid video content publish",
      input: TestDataFactory.createSimplePost("No video content"),
      expectedResult: "error",
      expectedError: "VALIDATION",
      description: "Publishing without video should fail",
    },
  ],

  analyticsTests: [
    {
      name: "Basic YouTube analytics",
      channelId: "test-channel-youtube",
      expectedResult: "success",
      description: "Fetch basic YouTube channel analytics",
    },
    {
      name: "YouTube analytics with date range",
      channelId: "test-channel-youtube",
      since: new Date("2024-01-01"),
      until: new Date("2024-01-31"),
      expectedResult: "success",
      description: "Fetch YouTube analytics for specific period",
    },
  ],
};

// YouTube-specific feature tests
export async function testYouTubeFeatures(): Promise<void> {
  console.log("🧪 Testing YouTube-specific features");

  // Test YouTube capabilities
  if (!YouTubeAdapter.capabilities?.publish) {
    throw new Error("YouTube adapter should support publishing");
  }

  if (!YouTubeAdapter.capabilities?.schedule) {
    throw new Error("YouTube adapter should support scheduling");
  }

  if (!YouTubeAdapter.capabilities?.analytics) {
    throw new Error("YouTube adapter should support analytics");
  }

  if (YouTubeAdapter.capabilities?.threading !== false) {
    throw new Error("YouTube adapter should not support threading");
  }

  // Test YouTube limits
  if (YouTubeAdapter.limits?.maxChars !== 5000) {
    throw new Error("YouTube adapter should have 5000 character description limit");
  }

  if (YouTubeAdapter.limits?.maxMediaPerPost !== 1) {
    throw new Error("YouTube adapter should support 1 video per upload");
  }

  // Test supported media types
  const supportedMedia = YouTubeAdapter.limits?.allowedMedia || [];
  if (!supportedMedia.includes("video") || supportedMedia.length !== 1) {
    throw new Error("YouTube adapter should only support video content");
  }

  console.log("✅ YouTube feature tests passed");
}

// Test YouTube Data API v3 specific features
export async function testYouTubeDataAPI(): Promise<void> {
  console.log("🧪 Testing YouTube Data API v3 features");

  // Test aspect ratios
  const aspectRatios = YouTubeAdapter.limits?.aspectRatios || [];
  const expectedRatios = ["16:9", "9:16", "1:1"];
  for (const ratio of expectedRatios) {
    if (!aspectRatios.includes(ratio)) {
      throw new Error(`YouTube adapter should support ${ratio} aspect ratio`);
    }
  }

  // Test video duration limits (12 hours for verified channels)
  if (YouTubeAdapter.limits?.maxVideoDuration !== 43200) {
    throw new Error("YouTube adapter should have 43200 second (12 hour) video limit");
  }

  console.log("✅ YouTube Data API tests passed");
}

// Run YouTube provider tests
export async function runYouTubeProviderTests(): Promise<void> {
  console.log("🚀 Starting YouTube provider integration tests");

  const runner = new ProviderTestRunner();

  try {
    // Run comprehensive test suite
    const results = await runner.runProviderSuite(youtubeTestSuite);

    // Run YouTube-specific feature tests
    await testYouTubeFeatures();
    await testYouTubeDataAPI();

    // Generate and log results
    const report = runner.generateReport([results]);
    console.log("\n" + report);

    // Check if all critical tests passed
    const totalFailed = results.overall.failed;
    if (totalFailed > 0) {
      console.warn(`⚠️  YouTube provider tests had ${totalFailed} failures`);
    } else {
      console.log("🎉 All YouTube provider tests passed!");
    }
  } catch (error) {
    console.error("❌ YouTube provider test suite failed:", error);
    throw error;
  }
}

// Export for use in main test runner
export { youtubeTestSuite };
