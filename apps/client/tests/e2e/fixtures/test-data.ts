/**
 * Test Data Fixtures
 * Provides consistent test data for E2E tests
 *
 * @file test-data.ts
 * @description Test data fixtures for client E2E tests
 * @layer infrastructure
 */

export const TestUsers = {
  standardUser: {
    email: "e2e-test-user@example.com",
    password: "Test123!@#",
    firstName: "Test",
    lastName: "User",
    role: "user" as const,
  },
  newUser: () => ({
    email: `test-${Date.now()}@example.com`,
    password: "NewUser123!@#",
    firstName: "New",
    lastName: "User",
    role: "user" as const,
  }),
};

export const TestProjects = {
  basicProject: {
    name: "E2E Test Project",
    description: "Project created for E2E testing",
    settings: {
      timezone: "UTC",
      defaultSchedule: "09:00",
      autoPublish: false,
    },
  },
  marketingProject: {
    name: "Marketing Campaign",
    description: "Marketing-focused project for campaign testing",
    settings: {
      timezone: "America/New_York",
      defaultSchedule: "14:00",
      autoPublish: true,
    },
  },
  multiChannelProject: {
    name: "Multi-Channel Project",
    description: "Project with multiple social media channels",
    settings: {
      timezone: "Europe/London",
      defaultSchedule: "10:30",
      autoPublish: false,
    },
  },
  randomProject: () => ({
    name: `Test Project ${Date.now()}`,
    description: `Generated project for testing ${new Date().toISOString()}`,
    settings: {
      timezone: "UTC",
      defaultSchedule: "12:00",
      autoPublish: false,
    },
  }),
};

export const TestChannels = {
  twitter: (projectId: string) => ({
    projectId,
    provider: "twitter",
    accountId: `twitter-${Date.now()}`,
    accountName: "Test Twitter Account",
    username: "@test_twitter",
    credentials: {
      accessToken: "test-twitter-token",
      refreshToken: "test-twitter-refresh",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    isActive: true,
    settings: {
      autoRetweet: false,
      threadingEnabled: true,
      characterLimit: 280,
    },
  }),
  instagram: (projectId: string) => ({
    projectId,
    provider: "instagram",
    accountId: `instagram-${Date.now()}`,
    accountName: "Test Instagram Account",
    username: "@test_instagram",
    credentials: {
      accessToken: "test-instagram-token",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    isActive: true,
    settings: {
      storiesEnabled: true,
      reelsEnabled: true,
      characterLimit: 2200,
    },
  }),
  facebook: (projectId: string) => ({
    projectId,
    provider: "facebook",
    accountId: `facebook-${Date.now()}`,
    accountName: "Test Facebook Page",
    username: "test-facebook-page",
    credentials: {
      accessToken: "test-facebook-token",
      pageId: "test-page-id",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    isActive: true,
    settings: {
      crossPosting: true,
      characterLimit: 63206,
    },
  }),
  linkedin: (projectId: string) => ({
    projectId,
    provider: "linkedin",
    accountId: `linkedin-${Date.now()}`,
    accountName: "Test LinkedIn Profile",
    username: "test-linkedin-profile",
    credentials: {
      accessToken: "test-linkedin-token",
      refreshToken: "test-linkedin-refresh",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    isActive: true,
    settings: {
      visibility: "public",
      characterLimit: 3000,
    },
  }),
};

export const TestPosts = {
  textPost: (projectId: string) => ({
    projectId,
    content: "This is a test post for E2E testing #automation #playwright",
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [],
    tags: ["automation", "testing"],
    category: "general",
  }),
  scheduledPost: (projectId: string) => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 2);

    return {
      projectId,
      content: "This post is scheduled for the future #scheduled",
      status: "SCHEDULED" as const,
      scheduledAt: futureDate,
      media: [],
      tags: ["scheduled"],
      category: "marketing",
    };
  },
  imagePost: (projectId: string) => ({
    projectId,
    content: "Post with image attachment #image #media",
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [
      {
        type: "image",
        filename: "test-image.jpg",
        size: 1024 * 500, // 500KB
        dimensions: { width: 1200, height: 800 },
      },
    ],
    tags: ["image", "media"],
    category: "content",
  }),
  longPost: (projectId: string) => ({
    projectId,
    content: "This is a very long post that tests character limits and content handling. ".repeat(
      10
    ),
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [],
    tags: ["long-content"],
    category: "test",
  }),
  multiMediaPost: (projectId: string) => ({
    projectId,
    content: "Post with multiple media attachments #multimedia",
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [
      {
        type: "image",
        filename: "image-1.jpg",
        size: 1024 * 800,
        dimensions: { width: 1200, height: 800 },
      },
      {
        type: "image",
        filename: "image-2.jpg",
        size: 1024 * 600,
        dimensions: { width: 1000, height: 600 },
      },
      {
        type: "video",
        filename: "video-1.mp4",
        size: 1024 * 1024 * 5, // 5MB
        duration: 30,
      },
    ],
    tags: ["multimedia"],
    category: "media",
  }),
  threadPost: (projectId: string) => ({
    projectId,
    content:
      "This is the first tweet in a thread. It's designed to test threading functionality across different platforms. ".repeat(
        2
      ),
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [],
    tags: ["thread"],
    category: "discussion",
    platformSpecific: {
      twitter: {
        threadEnabled: true,
        maxTweets: 5,
      },
    },
  }),
  randomPost: (projectId: string) => ({
    projectId,
    content: `Random test post created at ${new Date().toISOString()} #random #test`,
    status: "DRAFT" as const,
    scheduledAt: null,
    media: [],
    tags: ["random", "test"],
    category: "test",
  }),
};

export const TestMedia = {
  smallImage: {
    filename: "small-image.jpg",
    type: "image/jpeg",
    size: 1024 * 100, // 100KB
    dimensions: { width: 400, height: 300 },
    base64:
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  },
  mediumImage: {
    filename: "medium-image.png",
    type: "image/png",
    size: 1024 * 500, // 500KB
    dimensions: { width: 800, height: 600 },
    base64:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  },
  largeImage: {
    filename: "large-image.jpg",
    type: "image/jpeg",
    size: 1024 * 1024 * 2, // 2MB
    dimensions: { width: 1920, height: 1080 },
    base64:
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  },
  video: {
    filename: "test-video.mp4",
    type: "video/mp4",
    size: 1024 * 1024 * 10, // 10MB
    duration: 60,
    dimensions: { width: 1280, height: 720 },
  },
  invalidFile: {
    filename: "document.pdf",
    type: "application/pdf",
    size: 1024 * 1024, // 1MB
  },
  oversizedFile: {
    filename: "huge-image.jpg",
    type: "image/jpeg",
    size: 1024 * 1024 * 50, // 50MB - exceeds typical limits
    dimensions: { width: 4000, height: 3000 },
  },
};

export const TestAnalytics = {
  metrics: {
    totalPosts: 150,
    publishedPosts: 120,
    scheduledPosts: 25,
    draftPosts: 5,
    totalEngagement: 2850,
    totalReach: 45000,
    avgEngagementRate: 3.2,
    followerGrowth: 245,
    clickThroughRate: 1.8,
  },
  chartData: [
    { date: "2024-01-01", engagement: 120, reach: 1800 },
    { date: "2024-01-02", engagement: 150, reach: 2200 },
    { date: "2024-01-03", engagement: 180, reach: 2500 },
    { date: "2024-01-04", engagement: 140, reach: 2000 },
    { date: "2024-01-05", engagement: 200, reach: 2800 },
  ],
  topPosts: [
    {
      id: "post-1",
      content: "Top performing post with high engagement",
      engagement: 450,
      reach: 8500,
      date: "2024-01-03",
      platform: "twitter",
    },
    {
      id: "post-2",
      content: "Second best performing post",
      engagement: 320,
      reach: 6200,
      date: "2024-01-02",
      platform: "instagram",
    },
  ],
  audienceInsights: {
    demographics: [
      { ageGroup: "18-24", percentage: 25 },
      { ageGroup: "25-34", percentage: 35 },
      { ageGroup: "35-44", percentage: 20 },
      { ageGroup: "45-54", percentage: 15 },
      { ageGroup: "55+", percentage: 5 },
    ],
    geography: [
      { country: "United States", percentage: 45 },
      { country: "United Kingdom", percentage: 20 },
      { country: "Canada", percentage: 15 },
      { country: "Australia", percentage: 10 },
      { country: "Other", percentage: 10 },
    ],
    activity: [
      { hour: "00:00", activity: 5 },
      { hour: "08:00", activity: 25 },
      { hour: "12:00", activity: 40 },
      { hour: "18:00", activity: 60 },
      { hour: "21:00", activity: 45 },
    ],
  },
};

export const TestScheduling = {
  optimalTimes: {
    twitter: [
      { day: "monday", time: "09:00", engagement: 85 },
      { day: "tuesday", time: "14:00", engagement: 92 },
      { day: "wednesday", time: "11:00", engagement: 88 },
    ],
    instagram: [
      { day: "monday", time: "18:00", engagement: 90 },
      { day: "tuesday", time: "19:00", engagement: 95 },
      { day: "wednesday", time: "20:00", engagement: 87 },
    ],
  },
  scheduledPosts: [
    {
      id: "scheduled-1",
      content: "Morning announcement post",
      scheduledAt: "2024-01-10T09:00:00Z",
      channels: ["twitter", "facebook"],
      status: "scheduled",
    },
    {
      id: "scheduled-2",
      content: "Evening update post",
      scheduledAt: "2024-01-10T18:00:00Z",
      channels: ["instagram"],
      status: "scheduled",
    },
  ],
};

export const TestErrors = {
  network: {
    timeout: { code: "TIMEOUT", message: "Request timed out" },
    serverError: { code: "SERVER_ERROR", message: "Internal server error" },
    notFound: { code: "NOT_FOUND", message: "Resource not found" },
    unauthorized: { code: "UNAUTHORIZED", message: "Authentication required" },
    forbidden: { code: "FORBIDDEN", message: "Access denied" },
  },
  validation: {
    contentRequired: { field: "content", message: "Content is required" },
    channelRequired: { field: "channels", message: "At least one channel must be selected" },
    emailInvalid: { field: "email", message: "Invalid email format" },
    passwordWeak: { field: "password", message: "Password must be at least 8 characters" },
    fileTooLarge: { field: "media", message: "File size exceeds limit" },
    fileTypeInvalid: { field: "media", message: "File type not supported" },
  },
  platform: {
    characterLimit: { platform: "twitter", message: "Content exceeds 280 character limit" },
    rateLimited: { platform: "instagram", message: "Rate limit exceeded, try again later" },
    mediaLimit: { platform: "facebook", message: "Maximum 10 images per post" },
    connectionError: { platform: "linkedin", message: "Failed to connect to LinkedIn" },
  },
};

export const TestUrls = {
  login: "/login",
  signup: "/signup",
  dashboard: "/dashboard",
  posts: "/dashboard/posts",
  newPost: "/dashboard/posts/new",
  analytics: "/dashboard/analytics",
  channels: "/dashboard/channels",
  templates: "/dashboard/templates",
  scheduling: "/dashboard/scheduling",
  profile: "/profile",
  settings: "/settings",
};

export const TestSettings = {
  timeouts: {
    short: 5000,
    medium: 10000,
    long: 30000,
    network: 15000,
  },
  viewports: {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 720 },
    largeDesktop: { width: 1920, height: 1080 },
  },
  delays: {
    typing: 50,
    animation: 300,
    debounce: 500,
    autoSave: 1000,
  },
};

// Helper function to create test files
export function createTestFile(mediaData: any): File {
  const { filename, type, base64 } = mediaData;
  const byteCharacters = atob(base64.split(",")[1]);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new File(byteArrays, filename, { type });
}

// Helper function to generate random test data
export function generateRandomData() {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);

  return {
    user: TestUsers.newUser(),
    project: TestProjects.randomProject(),
    post: (projectId: string) => TestPosts.randomPost(projectId),
    email: `test-${randomId}@example.com`,
    content: `Random test content ${randomId} created at ${new Date().toISOString()}`,
    timestamp,
    randomId,
  };
}
