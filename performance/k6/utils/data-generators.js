import { randomString, randomItem } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

export class DataGenerator {
  constructor() {
    this.socialPlatforms = ["x", "facebook", "instagram", "youtube", "tiktok"];
    this.postTypes = ["text", "image", "video", "carousel"];
    this.contentTemplates = [
      "Check out our latest product update! 🚀",
      "Behind the scenes at our office today 📸",
      'Customer testimonial: "This changed my workflow completely!"',
      "Weekend vibes ✨ What are your plans?",
      "Pro tip: Here's how to boost your productivity",
      "Breaking: New feature announcement coming soon!",
      "Throwback to our successful launch event 🎉",
      "Industry insights: What we learned this quarter",
    ];
    this.hashtags = [
      "#productivity",
      "#tech",
      "#innovation",
      "#startup",
      "#growth",
      "#socialmedia",
      "#marketing",
      "#business",
      "#team",
      "#success",
    ];
  }

  /**
   * Generate realistic post content
   */
  generatePostContent(type = "text") {
    const template = randomItem(this.contentTemplates);
    const hashtag = randomItem(this.hashtags);

    const content = {
      text: `${template} ${hashtag}`,
      type: type,
      scheduledAt: this.getRandomFutureDate(),
      platforms: this.getRandomPlatforms(),
    };

    if (type === "image" || type === "carousel") {
      content.media = this.generateMediaFiles(type === "carousel" ? 3 : 1);
    } else if (type === "video") {
      content.media = this.generateVideoFile();
    }

    return content;
  }

  /**
   * Generate media file metadata
   */
  generateMediaFiles(count = 1) {
    const files = [];
    for (let i = 0; i < count; i++) {
      files.push({
        id: `media-${randomString(10)}`,
        filename: `image-${randomString(8)}.jpg`,
        size: Math.floor(Math.random() * 5000000) + 500000, // 0.5-5MB
        mimeType: "image/jpeg",
        url: `https://example.com/media/${randomString(16)}.jpg`,
        alt: `Generated image ${i + 1}`,
      });
    }
    return files;
  }

  /**
   * Generate video file metadata
   */
  generateVideoFile() {
    return [
      {
        id: `video-${randomString(10)}`,
        filename: `video-${randomString(8)}.mp4`,
        size: Math.floor(Math.random() * 50000000) + 10000000, // 10-60MB
        mimeType: "video/mp4",
        url: `https://example.com/media/${randomString(16)}.mp4`,
        duration: Math.floor(Math.random() * 120) + 15, // 15-135 seconds
      },
    ];
  }

  /**
   * Generate random future date for scheduling
   */
  getRandomFutureDate() {
    const now = new Date();
    const futureDate = new Date(now.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000); // Next 7 days
    return futureDate.toISOString();
  }

  /**
   * Get random subset of platforms
   */
  getRandomPlatforms(min = 1, max = 3) {
    const count = Math.floor(Math.random() * (max - min + 1)) + min;
    const shuffled = [...this.socialPlatforms].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  /**
   * Generate project data
   */
  generateProject() {
    return {
      name: `Project ${randomString(8)}`,
      description: `Performance test project created at ${new Date().toISOString()}`,
      locale: randomItem(["en", "es", "fr", "de"]),
      timezone: randomItem(["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"]),
    };
  }

  /**
   * Generate channel (social account) data
   */
  generateChannel(platform = null) {
    const selectedPlatform = platform || randomItem(this.socialPlatforms);
    return {
      platform: selectedPlatform,
      accountName: `test_account_${randomString(8)}`,
      externalId: randomString(16),
      isActive: true,
      metadata: this.getChannelMetadata(selectedPlatform),
    };
  }

  /**
   * Get platform-specific metadata
   */
  getChannelMetadata(platform) {
    const baseMetadata = {
      followers: Math.floor(Math.random() * 100000) + 1000,
      verified: Math.random() > 0.8,
    };

    switch (platform) {
      case "x":
        return {
          ...baseMetadata,
          username: `@test_${randomString(8)}`,
          bio: "Performance testing account",
        };
      case "instagram":
        return {
          ...baseMetadata,
          username: `test_${randomString(8)}`,
          isBusinessAccount: true,
        };
      case "youtube":
        return {
          ...baseMetadata,
          channelName: `Test Channel ${randomString(8)}`,
          subscriberCount: Math.floor(Math.random() * 50000) + 500,
        };
      case "tiktok":
        return {
          ...baseMetadata,
          username: `@test${randomString(8)}`,
          likes: Math.floor(Math.random() * 1000000) + 10000,
        };
      default:
        return baseMetadata;
    }
  }

  /**
   * Generate analytics data
   */
  generateAnalyticsData(postId, platform) {
    const baseMetrics = {
      postId,
      platform,
      timestamp: new Date().toISOString(),
      impressions: Math.floor(Math.random() * 10000) + 100,
      engagements: Math.floor(Math.random() * 1000) + 10,
      clicks: Math.floor(Math.random() * 500) + 5,
    };

    // Platform-specific metrics
    switch (platform) {
      case "x":
        return {
          ...baseMetrics,
          retweets: Math.floor(Math.random() * 100) + 1,
          replies: Math.floor(Math.random() * 50) + 1,
          likes: Math.floor(Math.random() * 500) + 10,
        };
      case "instagram":
        return {
          ...baseMetrics,
          likes: Math.floor(Math.random() * 1000) + 20,
          comments: Math.floor(Math.random() * 100) + 5,
          saves: Math.floor(Math.random() * 200) + 10,
          shares: Math.floor(Math.random() * 50) + 2,
        };
      case "youtube":
        return {
          ...baseMetrics,
          views: Math.floor(Math.random() * 50000) + 500,
          likes: Math.floor(Math.random() * 2000) + 50,
          comments: Math.floor(Math.random() * 200) + 10,
          subscriberGain: Math.floor(Math.random() * 20) + 1,
        };
      default:
        return baseMetrics;
    }
  }

  /**
   * Generate user journey data
   */
  generateUserJourney() {
    const journeys = [
      {
        name: "content_creator",
        steps: [
          "login",
          "create_project",
          "add_channels",
          "create_post",
          "schedule_post",
          "view_analytics",
        ],
      },
      {
        name: "social_manager",
        steps: [
          "login",
          "view_dashboard",
          "bulk_schedule",
          "review_analytics",
          "export_report",
          "team_collaboration",
        ],
      },
      {
        name: "analyst",
        steps: [
          "login",
          "view_analytics_dashboard",
          "filter_date_range",
          "compare_platforms",
          "export_data",
        ],
      },
    ];

    return randomItem(journeys);
  }

  /**
   * Generate stress test data
   */
  generateStressTestPayload(size = "medium") {
    const sizes = {
      small: { textLength: 100, mediaCount: 0 },
      medium: { textLength: 500, mediaCount: 2 },
      large: { textLength: 2000, mediaCount: 5 },
      xlarge: { textLength: 4000, mediaCount: 10 },
    };

    const config = sizes[size] || sizes.medium;

    return {
      content: randomString(config.textLength),
      media: this.generateMediaFiles(config.mediaCount),
      platforms: this.socialPlatforms, // All platforms
      metadata: {
        tags: Array.from({ length: 10 }, () => randomString(8)),
        category: randomString(20),
        priority: Math.floor(Math.random() * 5) + 1,
      },
    };
  }

  /**
   * Generate provider-specific test data
   */
  generateProviderTestData(provider) {
    const baseData = {
      provider,
      timestamp: new Date().toISOString(),
      requestId: randomString(16),
    };

    switch (provider) {
      case "facebook":
        return {
          ...baseData,
          pageId: randomString(15),
          accessToken: randomString(200),
          permissions: ["pages_manage_posts", "pages_read_engagement"],
        };
      case "instagram":
        return {
          ...baseData,
          accountId: randomString(12),
          mediaType: randomItem(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
          caption: randomString(200),
        };
      case "youtube":
        return {
          ...baseData,
          channelId: randomString(24),
          videoId: randomString(11),
          title: randomString(100),
          description: randomString(500),
        };
      default:
        return baseData;
    }
  }
}
