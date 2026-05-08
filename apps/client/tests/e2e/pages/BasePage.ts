/**
 * @file BasePage.ts
 * @description Tests for base page
 * @layer infrastructure
 */
// Page type not used directly '@playwright/test';

/**
 * Base Page Object Model
 * Provides common functionality shared across all pages
 */

export abstract class BasePage {
  protected page: Page;

  constructor(_page: Page) {
    this.page = page;
  }

  // Common locators
  get loadingSpinner(): Locator {
    return this.page.locator('[data-testid="loading-spinner"]');
  }

  get errorMessage(): Locator {
    return this.page.locator('[data-testid="error-message"]');
  }

  get successMessage(): Locator {
    return this.page.locator('[data-testid="success-message"]');
  }

  get toastNotification(): Locator {
    return this.page.locator('[data-testid="toast"]');
  }

  // Navigation methods
  async goto(path: string) {
    await this.page.goto(path);
    await this.waitForPageLoad();
  }

  async waitForPageLoad() {
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForFunction(() => document.readyState === "complete");
  }

  // Common interactions
  async fillInput(selector: string, value: string) {
    await this.page.fill(selector, value);
  }

  async clickButton(selector: string) {
    await this.page.click(selector);
  }

  async selectOption(selector: string, value: string) {
    await this.page.selectOption(selector, value);
  }

  // Wait for elements
  async waitForElement(selector: string, timeout: number = 10000) {
    return this.page.waitForSelector(selector, { timeout });
  }

  async waitForElementToBeHidden(selector: string, timeout: number = 10000) {
    await this.page.waitForSelector(selector, { state: "hidden", timeout });
  }

  // Assertions
  async expectElementToBeVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  async expectElementToBeHidden(selector: string) {
    await expect(this.page.locator(selector)).toBeHidden();
  }

  async expectElementToContainText(selector: string, text: string) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  // Form helpers
  async fillForm(formData: Record<string, string>) {
    for (const [field, value] of Object.entries(formData)) {
      await this.fillInput(`[data-testid="${field}"]`, value);
    }
  }

  async submitForm(submitButtonSelector?: string) {
    const selector = submitButtonSelector || '[data-testid="submit-button"]';
    await this.clickButton(selector);
  }

  // Loading states
  async waitForLoading() {
    await this.loadingSpinner.waitFor({ state: "visible" });
  }

  async waitForLoadingToFinish() {
    await this.loadingSpinner.waitFor({ state: "hidden" });
  }

  // Error handling
  async expectNoErrors() {
    await expect(this.errorMessage).toBeHidden();
  }

  async expectError(message?: string) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  // Success handling
  async expectSuccess(message?: string) {
    await expect(this.successMessage).toBeVisible();
    if (message) {
      await expect(this.successMessage).toContainText(message);
    }
  }

  // Toast notifications
  async expectToast(message: string, type?: "success" | "error" | "warning" | "info") {
    await expect(this.toastNotification).toBeVisible();
    await expect(this.toastNotification).toContainText(message);

    if (type) {
      await expect(this.toastNotification).toHaveClass(new RegExp(`toast-${type}`));
    }
  }

  async waitForToastToDisappear() {
    await this.toastNotification.waitFor({ state: "hidden" });
  }

  // URL assertions
  async expectUrl(expectedUrl: string | RegExp) {
    if (typeof expectedUrl === "string") {
      await expect(this.page).toHaveURL(expectedUrl);
    } else {
      await expect(this.page).toHaveURL(expectedUrl);
    }
  }

  // Screenshot helpers
  async takeScreenshot(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
  }

  async compareScreenshot(name: string) {
    await expect(this.page).toHaveScreenshot(`${name}.png`);
  }

  // Mobile helpers
  async scrollToElement(selector: string) {
    await this.page.locator(selector).scrollIntoViewIfNeeded();
  }

  async swipeElement(selector: string, direction: "left" | "right" | "up" | "down") {
    const element = this.page.locator(selector);
    const box = await element.boundingBox();

    if (!box) throw new Error(`Element ${selector} not found`);

    const { x, y, width, height } = box;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    let startX = centerX;
    let startY = centerY;
    let endX = centerX;
    let endY = centerY;

    switch (direction) {
      case "left":
        startX = x + width * 0.8;
        endX = x + width * 0.2;
        break;
      case "right":
        startX = x + width * 0.2;
        endX = x + width * 0.8;
        break;
      case "up":
        startY = y + height * 0.8;
        endY = y + height * 0.2;
        break;
      case "down":
        startY = y + height * 0.2;
        endY = y + height * 0.8;
        break;
    }

    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, endY);
    await this.page.mouse.up();
  }

  // Keyboard helpers
  async pressKey(key: string) {
    await this.page.keyboard.press(key);
  }

  async typeText(text: string, delay?: number) {
    await this.page.keyboard.type(text, { delay });
  }

  // Network helpers
  async waitForRequest(urlPattern: string | RegExp) {
    return this.page.waitForRequest(urlPattern);
  }

  async waitForResponse(urlPattern: string | RegExp, status?: number) {
    return this.page.waitForResponse((response) => {
      const url = response.url();
      const matchesUrl =
        typeof urlPattern === "string" ? url.includes(urlPattern) : urlPattern.test(url);
      const matchesStatus = status ? response.status() === status : true;
      return matchesUrl && matchesStatus;
    });
  }

  // Performance helpers
  async measurePageLoadTime(): Promise<number> {
    return this.page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming;
      return navigation.loadEventEnd - navigation.fetchStart;
    });
  }

  async getMemoryUsage(): Promise<any> {
    return this.page.evaluate(() => {
      // @ts-ignore - performance.memory is available in Chrome
      return (performance as any).memory;
    });
  }
}
