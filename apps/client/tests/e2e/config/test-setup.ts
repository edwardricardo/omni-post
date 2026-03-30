import { test as base, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * Extended test fixtures with custom utilities
 * Provides reusable functionality across all E2E tests
 */

// Custom test fixtures
type TestFixtures = {
  authenticatedPage: Page;
  adminPage: Page;
  axeBuilder: AxeBuilder;
  testData: TestDataHelper;
  apiHelper: ApiHelper;
};

// Test data helper class
export class TestDataHelper {
  constructor(private page: Page) {}

  /**
   * Create a test user with specified role
   */
  async createTestUser(role: "user" | "admin" = "user") {
    const _userData = {
      email: `test-${Date.now()}@example.com`,
      password: "Test123!@#",
      firstName: "Test",
      lastName: "User",
      role,
    };

    await this.page.request.post("/api/auth/customer/register", {
      data: userData,
    });

    return userData;
  }

  /**
   * Create a test project with sample data
   */
  async createTestProject() {
    const projectData = {
      name: `Test Project ${Date.now()}`,
      description: "E2E test project",
      settings: {
        timezone: "UTC",
        defaultSchedule: "09:00",
      },
    };

    const response = await this.page.request.post("/api/projects", {
      data: projectData,
    });

    return response.json();
  }

  /**
   * Create a test post with content
   */
  async createTestPost(projectId: string, content: string = "Test post content") {
    const postData = {
      projectId,
      content,
      status: "DRAFT",
      scheduledAt: null,
    };

    const response = await this.page.request.post("/api/posts", {
      data: postData,
    });

    return response.json();
  }

  /**
   * Create test social media channel
   */
  async createTestChannel(projectId: string, _provider: string = "twitter") {
    const channelData = {
      projectId,
      provider,
      accountId: `test-${provider}-${Date.now()}`,
      accountName: `Test ${provider} Account`,
      credentials: {
        accessToken: "test-token",
        refreshToken: "test-refresh",
      },
      isActive: true,
    };

    const response = await this.page.request.post("/api/channels", {
      data: channelData,
    });

    return response.json();
  }
}

// API helper class
export class ApiHelper {
  constructor(private page: Page) {}

  /**
   * Wait for API call to complete
   */
  async waitForApiCall(urlPattern: string | RegExp, timeout: number = 10000) {
    return this.page.waitForResponse(
      (response) => {
        const url = response.url();
        return typeof urlPattern === "string" ? url.includes(urlPattern) : urlPattern.test(url);
      },
      { timeout }
    );
  }

  /**
   * Mock API response
   */
  async mockApiResponse(url: string | RegExp, response: any, status: number = 200) {
    await this.page.route(url, (route) => {
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });
  }

  /**
   * Intercept and modify API request
   */
  async interceptRequest(url: string | RegExp, modifier: (request: any) => any) {
    await this.page.route(url, async (route) => {
      const request = route.request();
      const modifiedData = modifier(request);

      await route.continue({
        postData: JSON.stringify(modifiedData),
      });
    });
  }
}

// Extended test with custom fixtures
export const test = base.extend<TestFixtures>({
  // Authenticated user page
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: "tests/e2e/fixtures/test-user-auth.json",
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  // Admin user page
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: "tests/e2e/fixtures/test-admin-auth.json",
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  // Accessibility testing builder
  axeBuilder: async ({ page }, use) => {
    const axeBuilder = new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .exclude("#ads") // Exclude elements that shouldn't be tested
      .exclude('[data-testid="third-party-widget"]');

    await use(axeBuilder);
  },

  // Test data helper
  testData: async ({ page }, use) => {
    const helper = new TestDataHelper(page);
    await use(helper);
  },

  // API helper
  apiHelper: async ({ page }, use) => {
    const helper = new ApiHelper(page);
    await use(helper);
  },
});

// Custom assertions
export const customExpect = expect.extend({
  /**
   * Assert that an element is accessible
   */
  async toBeAccessible(received: Page) {
    const axeBuilder = new AxeBuilder({ page: received });
    const results = await axeBuilder.analyze();

    const pass = results.violations.length === 0;

    if (pass) {
      return {
        message: () => "Expected page to have accessibility violations",
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected page to be accessible but found ${results.violations.length} violations:\n${results.violations
            .map((v) => `- ${v.description}`)
            .join("\n")}`,
        pass: false,
      };
    }
  },

  /**
   * Assert that an API response matches schema
   */
  async toMatchApiSchema(received: any, schema: any) {
    try {
      schema.parse(received);
      return {
        message: () => "Expected response to not match schema",
        pass: true,
      };
    } catch (error) {
      return {
        message: () =>
          `Expected response to match schema but got validation error: ${error.message}`,
        pass: false,
      };
    }
  },
});

// Export the enhanced test and expect
export { expect } from "@playwright/test";
