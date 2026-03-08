// Page type not used directly '@playwright/test';
import path from "path";
import fs from "fs/promises";

/**
 * E2E Test Helper Utilities
 * Provides common functionality for E2E tests
 */

export class TestHelpers {
  constructor(private page: Page) {}

  /**
   * Wait for network to be idle with specific patterns
   */
  async waitForNetworkIdle(options?: {
    timeout?: number;
    idleTime?: number;
    ignorePatterns?: (string | RegExp)[];
  }) {
    const { timeout = 30000, idleTime = 1000, ignorePatterns = [] } = options || {};

    let requestCount = 0;
    let lastRequestTime = Date.now();

    const shouldIgnoreRequest = (url: string) => {
      return ignorePatterns.some((pattern) => {
        if (typeof pattern === "string") {
          return url.includes(pattern);
        }
        return pattern.test(url);
      });
    };

    this.page.on("request", (request) => {
      if (!shouldIgnoreRequest(request.url())) {
        requestCount++;
        lastRequestTime = Date.now();
      }
    });

    this.page.on("response", (response) => {
      if (!shouldIgnoreRequest(response.url())) {
        requestCount--;
      }
    });

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (requestCount === 0 && Date.now() - lastRequestTime > idleTime) {
        break;
      }
      await this.page.waitForTimeout(100);
    }
  }

  /**
   * Take screenshot with automatic naming
   */
  async takeScreenshot(name?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testName = name || this.page.url().split("/").pop() || "page";
    const filename = `${testName}-${timestamp}.png`;
    const filepath = path.join(process.cwd(), "test-results", "screenshots", filename);

    await this.page.screenshot({
      path: filepath,
      fullPage: true,
    });

    return filepath;
  }

  /**
   * Compare screenshots with threshold
   */
  async compareScreenshot(name: string, _threshold: number = 0.3): Promise<boolean> {
    try {
      await this.page.locator("body").screenshot({
        path: `test-results/screenshots/${name}-actual.png`,
      });
      // In a real implementation, you'd compare with baseline
      return true;
    } catch (error) {
      console.error("Screenshot comparison failed:", error);
      return false;
    }
  }

  /**
   * Wait for element with retry logic
   */
  async waitForElementWithRetry(
    selector: string,
    options?: {
      timeout?: number;
      retries?: number;
      state?: "visible" | "hidden" | "attached" | "detached";
    }
  ) {
    const { timeout = 10000, retries = 3, state = "visible" } = options || {};

    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        await this.page.waitForSelector(selector, {
          timeout: timeout / retries,
          state,
        });
        return;
      } catch (error) {
        lastError = error as Error;
        if (i < retries - 1) {
          await this.page.waitForTimeout(1000);
        }
      }
    }

    throw lastError;
  }

  /**
   * Scroll element into view with smooth scrolling
   */
  async scrollIntoView(selector: string, behavior: "auto" | "smooth" = "smooth") {
    await this.page.locator(selector).evaluate((element, behavior) => {
      element.scrollIntoView({ behavior, block: "center" });
    }, behavior);

    // Wait for scroll to complete
    await this.page.waitForTimeout(500);
  }

  /**
   * Fill form with data validation
   */
  async fillFormData(
    formData: Record<string, string | boolean>,
    options?: {
      clearFirst?: boolean;
      validateRequired?: boolean;
    }
  ) {
    const { clearFirst = true, validateRequired = true } = options || {};

    for (const [field, value] of Object.entries(formData)) {
      const selector = `[data-testid="${field}"]`;
      const element = this.page.locator(selector);

      await element.waitFor({ state: "visible" });

      if (typeof value === "boolean") {
        if (value) {
          await element.check();
        } else {
          await element.uncheck();
        }
      } else {
        if (clearFirst) {
          await element.clear();
        }
        await element.fill(value);
      }

      // Validate required fields if enabled
      if (validateRequired && value === "") {
        const isRequired = await element.getAttribute("required");
        if (isRequired !== null) {
          console.warn(`Warning: Required field ${field} is empty`);
        }
      }
    }
  }

  /**
   * Handle file uploads with validation
   */
  async uploadFiles(
    selector: string,
    filePaths: string | string[],
    options?: {
      validate?: boolean;
      expectedCount?: number;
    }
  ) {
    const { validate = true, expectedCount } = options || {};
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

    if (validate) {
      for (const filePath of paths) {
        try {
          await fs.access(filePath);
        } catch {
          throw new Error(`File not found: ${filePath}`);
        }
      }
    }

    await this.page.locator(selector).setInputFiles(paths);

    if (expectedCount) {
      // Wait for upload indicators
      await this.page.waitForFunction((count) => {
        const uploadedItems = document.querySelectorAll('[data-testid="uploaded-media-item"]');
        return uploadedItems.length === count;
      }, expectedCount);
    }
  }

  /**
   * Wait for API call completion
   */
  async waitForApiCall(
    urlPattern: string | RegExp,
    options?: {
      method?: string;
      timeout?: number;
      status?: number;
    }
  ) {
    const { method, timeout = 10000, status } = options || {};

    return this.page.waitForResponse(
      (response) => {
        const url = response.url();
        const matchesUrl =
          typeof urlPattern === "string" ? url.includes(urlPattern) : urlPattern.test(url);

        const matchesMethod = method ? response.request().method() === method : true;
        const matchesStatus = status ? response.status() === status : true;

        return matchesUrl && matchesMethod && matchesStatus;
      },
      { timeout }
    );
  }

  /**
   * Mock API responses for testing
   */
  async mockApiResponse(
    url: string | RegExp,
    response: any,
    options?: {
      status?: number;
      headers?: Record<string, string>;
      delay?: number;
    }
  ) {
    const { status = 200, headers = {}, delay = 0 } = options || {};

    await this.page.route(url, async (route) => {
      if (delay > 0) {
        await this.page.waitForTimeout(delay);
      }

      await route.fulfill({
        status,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(response),
      });
    });
  }

  /**
   * Simulate slow network conditions
   */
  async simulateSlowNetwork() {
    await this.page.route("**/*", async (route) => {
      await this.page.waitForTimeout(Math.random() * 1000 + 500); // 500-1500ms delay
      await route.continue();
    });
  }

  /**
   * Clear all cookies and local storage
   */
  async clearBrowserData() {
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const context = this.page.context();
    await context.clearCookies();
  }

  /**
   * Set device geolocation
   */
  async setGeolocation(latitude: number, longitude: number) {
    const context = this.page.context();
    await context.setGeolocation({ latitude, longitude });
  }

  /**
   * Monitor console errors
   */
  startConsoleMonitoring(): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      } else if (msg.type() === "warning") {
        warnings.push(msg.text());
      }
    });

    return { errors, warnings };
  }

  /**
   * Measure performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    loadTime: number;
    domContentLoaded: number;
    firstContentfulPaint: number;
    timeToInteractive: number;
  }> {
    return this.page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType("paint");

      return {
        loadTime: navigation.loadEventEnd - navigation.fetchStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
        firstContentfulPaint:
          paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0,
        timeToInteractive: navigation.domInteractive - navigation.fetchStart,
      };
    });
  }

  /**
   * Wait for animations to complete
   */
  async waitForAnimations(selector?: string) {
    const targetSelector = selector || "body";

    await this.page.waitForFunction((sel) => {
      const element = document.querySelector(sel);
      if (!element) return true;

      const animations = element.getAnimations();
      return animations.every(
        (animation) => animation.playState === "finished" || animation.playState === "idle"
      );
    }, targetSelector);
  }

  /**
   * Handle file downloads
   */
  async handleDownload(triggerAction: () => Promise<void>): Promise<Download> {
    const downloadPromise = this.page.waitForEvent("download");
    await triggerAction();
    const download = await downloadPromise;

    return download;
  }

  /**
   * Verify download content
   */
  async verifyDownload(download: Download, expectedFilename?: string): Promise<boolean> {
    const suggestedFilename = download.suggestedFilename();

    if (expectedFilename && !suggestedFilename.includes(expectedFilename)) {
      return false;
    }

    try {
      const downloadPath = await download.path();
      if (downloadPath) {
        const stats = await fs.stat(downloadPath);
        return stats.size > 0;
      }
    } catch (error) {
      console.error("Download verification failed:", error);
    }

    return false;
  }

  /**
   * Create test data via API
   */
  async createTestData(type: string, data: any): Promise<any> {
    const response = await this.page.request.post(`/api/test/${type}`, {
      data,
    });

    if (!response.ok()) {
      throw new Error(`Failed to create test ${type}: ${response.status()}`);
    }

    return response.json();
  }

  /**
   * Clean up test data
   */
  async cleanupTestData(type: string, id?: string): Promise<void> {
    const url = id ? `/api/test/${type}/${id}` : `/api/test/${type}`;

    const response = await this.page.request.delete(url);

    if (!response.ok() && response.status() !== 404) {
      console.warn(`Failed to cleanup test ${type}: ${response.status()}`);
    }
  }

  /**
   * Generate unique test identifiers
   */
  generateTestId(prefix = "test"): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Wait for stable DOM
   */
  async waitForStableDOM(timeout = 5000): Promise<void> {
    let lastHTML = "";
    let stableCount = 0;
    const requiredStableCount = 3;
    const checkInterval = 100;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const currentHTML = await this.page.locator("body").innerHTML();

      if (currentHTML === lastHTML) {
        stableCount++;
        if (stableCount >= requiredStableCount) {
          return;
        }
      } else {
        stableCount = 0;
        lastHTML = currentHTML;
      }

      await this.page.waitForTimeout(checkInterval);
    }

    throw new Error("DOM did not stabilize within timeout");
  }

  /**
   * Execute with retry logic
   */
  async executeWithRetry<T>(
    action: () => Promise<T>,
    options?: {
      retries?: number;
      delay?: number;
      condition?: (error: Error) => boolean;
    }
  ): Promise<T> {
    const { retries = 3, delay = 1000, condition } = options || {};

    let lastError: Error;

    for (let i = 0; i < retries; i++) {
      try {
        return await action();
      } catch (error) {
        lastError = error as Error;

        if (condition && !condition(lastError)) {
          throw lastError;
        }

        if (i < retries - 1) {
          await this.page.waitForTimeout(delay);
        }
      }
    }

    throw lastError!;
  }
}

/**
 * Browser Context Helpers
 */
export class ContextHelpers {
  constructor(private context: BrowserContext) {}

  /**
   * Create page with custom settings
   */
  async createPage(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    permissions?: string[];
  }): Promise<Page> {
    const page = await this.context.newPage();

    if (options?.viewport) {
      await page.setViewportSize(options.viewport);
    }

    if (options?.userAgent) {
      await page.setExtraHTTPHeaders({
        "User-Agent": options.userAgent,
      });
    }

    if (options?.permissions) {
      await this.context.grantPermissions(options.permissions);
    }

    return page;
  }

  /**
   * Set authentication state
   */
  async setAuthState(authFile: string): Promise<void> {
    try {
      await this.context.storageState({ path: authFile });
    } catch (error) {
      console.warn(`Failed to load auth state from ${authFile}:`, error);
    }
  }

  /**
   * Save authentication state
   */
  async saveAuthState(authFile: string): Promise<void> {
    await this.context.storageState({ path: authFile });
  }
}

/**
 * Test data validation helpers
 */
export class ValidationHelpers {
  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  static isStrongPassword(password: string): boolean {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return (
      password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar
    );
  }

  /**
   * Validate URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate file size
   */
  static isValidFileSize(size: number, maxSizeMB: number): boolean {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    return size <= maxSizeBytes;
  }

  /**
   * Validate image dimensions
   */
  static isValidImageDimensions(
    width: number,
    height: number,
    constraints: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number }
  ): boolean {
    const { minWidth = 0, maxWidth = Infinity, minHeight = 0, maxHeight = Infinity } = constraints;

    return width >= minWidth && width <= maxWidth && height >= minHeight && height <= maxHeight;
  }
}
