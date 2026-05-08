/**
 * @file assertions.ts
 * @description Tests for assertions
 * @layer infrastructure
 */
// Page type not used directly '@playwright/test';
import { expectPageToBeAccessible, type A11yImpact, type A11yOptions } from "./a11y";

/**
 * Custom Assertions for E2E Tests
 * Provides domain-specific assertions for the social media CMS
 */

export class CustomAssertions {
  constructor(private page: Page) {}

  /**
   * @deprecated Use the standalone `expectPageToBeAccessible(page, options)`
   *             from `./a11y.ts` directly. This method delegates to it.
   *             Canon: `axe-core-playwright-a11y-testing-for-e2e-suites`.
   */
  async expectPageToBeAccessible(options?: {
    tags?: string[];
    exclude?: string[];
    includedImpacts?: string[];
  }): Promise<void> {
    const normalized: A11yOptions = {};
    if (options?.tags) normalized.tags = options.tags;
    if (options?.exclude) normalized.exclude = options.exclude;
    if (options?.includedImpacts) {
      normalized.includedImpacts = options.includedImpacts as A11yImpact[];
    }
    await expectPageToBeAccessible(this.page, normalized);
  }

  /**
   * Assert that element has proper ARIA attributes
   */
  async expectElementToHaveAccessibleName(locator: Locator, expectedName?: string) {
    await expect(locator).toHaveAttribute("aria-label");

    if (expectedName) {
      const ariaLabel = await locator.getAttribute("aria-label");
      expect(ariaLabel).toContain(expectedName);
    }
  }

  /**
   * Assert that form has proper validation
   */
  async expectFormToHaveValidation(
    formSelector: string,
    fieldValidations: Record<string, string[]>
  ) {
    for (const [fieldName, expectedErrors] of Object.entries(fieldValidations)) {
      const field = this.page.locator(`${formSelector} [data-testid="${fieldName}"]`);

      // Trigger validation by focusing and blurring
      await field.focus();
      await field.blur();

      for (const errorMessage of expectedErrors) {
        await expect(this.page.locator(`[data-testid="${fieldName}-error"]`)).toContainText(
          errorMessage
        );
      }
    }
  }

  /**
   * Assert that API response matches expected schema
   */
  async expectApiResponseToMatchSchema(response: any, schema: any) {
    try {
      schema.parse(response);
    } catch (error) {
      throw new Error(`API response does not match schema: ${error.message}`);
    }
  }

  /**
   * Assert that loading states are handled properly
   */
  async expectLoadingStateToBeHandled(
    triggerAction: () => Promise<void>,
    options?: {
      loadingSelector?: string;
      timeout?: number;
    }
  ) {
    const { loadingSelector = '[data-testid="loading-spinner"]', timeout = 10000 } = options || {};

    const startTime = Date.now();

    // Execute action that should trigger loading
    await triggerAction();

    // Loading indicator should appear
    await expect(this.page.locator(loadingSelector)).toBeVisible({ timeout: 2000 });

    // Loading indicator should disappear
    await expect(this.page.locator(loadingSelector)).toBeHidden({ timeout });

    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(timeout);
  }

  /**
   * Assert that error handling works correctly
   */
  async expectErrorToBeHandled(triggerAction: () => Promise<void>, expectedError: string) {
    await triggerAction();

    // Error message should be displayed
    await expect(this.page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="error-message"]')).toContainText(expectedError);

    // Page should remain functional
    await expect(this.page.locator("body")).not.toHaveClass(/crashed/);
  }

  /**
   * Assert that character count is accurate
   */
  async expectCharacterCountToBeAccurate(contentSelector: string, countSelector: string) {
    const content = await this.page.locator(contentSelector).inputValue();
    const displayedCount = await this.page.locator(countSelector).textContent();

    const actualCount = content.length;
    expect(parseInt(displayedCount || "0")).toBe(actualCount);
  }

  /**
   * Assert that media upload is successful
   */
  async expectMediaUploadToBeSuccessful(
    uploadedItemsSelector: string,
    expectedCount: number,
    timeout = 10000
  ) {
    // Wait for upload to complete
    await this.page.waitForFunction(
      ({ selector, count }) => {
        const items = document.querySelectorAll(selector);
        return items.length === count;
      },
      { selector: uploadedItemsSelector, count: expectedCount },
      { timeout }
    );

    const items = this.page.locator(uploadedItemsSelector);
    await expect(items).toHaveCount(expectedCount);

    // Check that each item has a preview
    for (let i = 0; i < expectedCount; i++) {
      await expect(items.nth(i).locator('[data-testid="media-preview"]')).toBeVisible();
    }
  }

  /**
   * Assert that auto-save is working
   */
  async expectAutoSaveToWork(contentSelector: string, timeout = 5000) {
    // Type content
    await this.page.locator(contentSelector).fill("Test auto-save content");

    // Wait for auto-save indicator
    await expect(this.page.locator('[data-testid="auto-save-indicator"]')).toContainText(
      /saving|saved/i,
      { timeout }
    );

    // Verify saved state
    await expect(this.page.locator('[data-testid="auto-save-indicator"]')).toContainText(/saved/i, {
      timeout,
    });
  }

  /**
   * Assert that scheduling works correctly
   */
  async expectSchedulingToWork(scheduledTime: string) {
    // Verify scheduled time is displayed
    await expect(this.page.locator('[data-testid="scheduled-datetime"]')).toContainText(
      scheduledTime
    );

    // Verify post status is scheduled
    await expect(this.page.locator('[data-testid="post-status"]')).toContainText("scheduled");
  }

  /**
   * Assert that platform previews are accurate
   */
  async expectPlatformPreviewToBeAccurate(
    platform: string,
    content: string,
    characterLimit?: number
  ) {
    const previewSelector = `[data-testid="${platform}-preview"]`;

    await expect(this.page.locator(previewSelector)).toBeVisible();
    await expect(this.page.locator(previewSelector)).toContainText(content);

    if (characterLimit) {
      const previewContent = await this.page.locator(previewSelector).textContent();
      expect(previewContent!.length).toBeLessThanOrEqual(characterLimit);
    }
  }

  /**
   * Assert that analytics data is valid
   */
  async expectAnalyticsDataToBeValid() {
    // Check that metrics are displayed
    const metricsSelectors = [
      '[data-testid="total-posts-metric"]',
      '[data-testid="total-engagement-metric"]',
      '[data-testid="total-reach-metric"]',
    ];

    for (const selector of metricsSelectors) {
      await expect(this.page.locator(selector)).toBeVisible();

      const value = await this.page.locator(selector).textContent();
      expect(value).toMatch(/\d+/); // Should contain numbers
    }

    // Check that charts are rendered
    await expect(this.page.locator('[data-testid="engagement-chart"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="reach-chart"]')).toBeVisible();
  }

  /**
   * Assert that charts are interactive
   */
  async expectChartsToBeInteractive(chartSelector: string) {
    const chart = this.page.locator(chartSelector);

    // Chart should be visible
    await expect(chart).toBeVisible();

    // Hover should show tooltip
    await chart.hover();
    await expect(this.page.locator('[data-testid="chart-tooltip"]')).toBeVisible();

    // Chart should have clickable elements
    const clickableElements = chart.locator('[role="button"], .clickable, [data-clickable="true"]');
    if ((await clickableElements.count()) > 0) {
      await expect(clickableElements.first()).toBeVisible();
    }
  }

  /**
   * Assert that responsive design works
   */
  async expectResponsiveDesignToWork(breakpoints: {
    mobile: number;
    tablet: number;
    desktop: number;
  }) {
    const { mobile, tablet, desktop } = breakpoints;

    // Test mobile layout
    await this.page.setViewportSize({ width: mobile, height: 667 });
    await this.page.waitForTimeout(500); // Allow layout to adjust

    await expect(this.page.locator('[data-testid="mobile-menu-button"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="sidebar-nav"]')).toBeHidden();

    // Test tablet layout
    await this.page.setViewportSize({ width: tablet, height: 1024 });
    await this.page.waitForTimeout(500);

    // Test desktop layout
    await this.page.setViewportSize({ width: desktop, height: 720 });
    await this.page.waitForTimeout(500);

    await expect(this.page.locator('[data-testid="sidebar-nav"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="mobile-menu-button"]')).toBeHidden();
  }

  /**
   * Assert that performance meets requirements
   */
  async expectPerformanceToMeetRequirements(requirements: {
    loadTime?: number;
    firstContentfulPaint?: number;
    interactiveTime?: number;
  }) {
    const metrics = await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType("paint");

      return {
        loadTime: navigation.loadEventEnd - navigation.fetchStart,
        firstContentfulPaint:
          paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0,
        interactiveTime: navigation.domInteractive - navigation.fetchStart,
      };
    });

    if (requirements.loadTime) {
      expect(metrics.loadTime).toBeLessThan(requirements.loadTime);
    }

    if (requirements.firstContentfulPaint) {
      expect(metrics.firstContentfulPaint).toBeLessThan(requirements.firstContentfulPaint);
    }

    if (requirements.interactiveTime) {
      expect(metrics.interactiveTime).toBeLessThan(requirements.interactiveTime);
    }
  }

  /**
   * Assert that search functionality works
   */
  async expectSearchToWork(searchSelector: string, searchTerm: string, resultSelector: string) {
    // Enter search term
    await this.page.locator(searchSelector).fill(searchTerm);
    await this.page.locator(searchSelector).press("Enter");

    // Wait for results
    await expect(this.page.locator(resultSelector)).toBeVisible({ timeout: 10000 });

    // Results should contain search term
    const results = this.page.locator(resultSelector);
    const count = await results.count();

    expect(count).toBeGreaterThan(0);

    // At least one result should contain the search term
    let foundMatch = false;
    for (let i = 0; i < count; i++) {
      const text = await results.nth(i).textContent();
      if (text?.toLowerCase().includes(searchTerm.toLowerCase())) {
        foundMatch = true;
        break;
      }
    }

    expect(foundMatch).toBe(true);
  }

  /**
   * Assert that pagination works correctly
   */
  async expectPaginationToWork(options: {
    itemSelector: string;
    nextButtonSelector: string;
    prevButtonSelector?: string;
    pageInfoSelector?: string;
    itemsPerPage?: number;
  }) {
    const {
      itemSelector,
      nextButtonSelector,
      prevButtonSelector,
      pageInfoSelector,
      itemsPerPage = 10,
    } = options;

    // Check initial page
    const initialItems = await this.page.locator(itemSelector).count();
    expect(initialItems).toBeGreaterThan(0);
    expect(initialItems).toBeLessThanOrEqual(itemsPerPage);

    // Test next page if button exists
    const nextButton = this.page.locator(nextButtonSelector);
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await this.page.waitForLoadState("networkidle");

      // Should have items on next page
      const nextPageItems = await this.page.locator(itemSelector).count();
      expect(nextPageItems).toBeGreaterThan(0);

      // Test previous page if button exists
      if (prevButtonSelector) {
        const prevButton = this.page.locator(prevButtonSelector);
        if (await prevButton.isVisible()) {
          await prevButton.click();
          await this.page.waitForLoadState("networkidle");

          const prevPageItems = await this.page.locator(itemSelector).count();
          expect(prevPageItems).toBe(initialItems);
        }
      }
    }

    // Check page info if provided
    if (pageInfoSelector) {
      await expect(this.page.locator(pageInfoSelector)).toBeVisible();
      const pageInfo = await this.page.locator(pageInfoSelector).textContent();
      expect(pageInfo).toMatch(/page|of|\d+/i);
    }
  }

  /**
   * Assert that real-time updates work
   */
  async expectRealTimeUpdatesToWork(triggerAction: () => Promise<void>, updateSelector: string) {
    // Get initial state
    const initialContent = await this.page.locator(updateSelector).textContent();

    // Trigger update
    await triggerAction();

    // Wait for update to appear
    await expect(this.page.locator(updateSelector)).not.toHaveText(initialContent || "");

    // Verify update is reflected
    const updatedContent = await this.page.locator(updateSelector).textContent();
    expect(updatedContent).not.toBe(initialContent);
  }

  /**
   * Assert that keyboard navigation works
   */
  async expectKeyboardNavigationToWork(focusableSelectors: string[]) {
    let _currentIndex = 0;

    // Tab through each focusable element
    for (const selector of focusableSelectors) {
      await this.page.keyboard.press("Tab");

      // Element should be focused
      await expect(this.page.locator(selector)).toBeFocused();

      currentIndex++;
    }

    // Should be able to tab backwards
    for (let i = focusableSelectors.length - 1; i >= 0; i--) {
      await this.page.keyboard.press("Shift+Tab");
      await expect(this.page.locator(focusableSelectors[i])).toBeFocused();
    }
  }

  /**
   * Assert that toast notifications work correctly
   */
  async expectToastNotificationToWork(
    triggerAction: () => Promise<void>,
    expectedMessage: string,
    type: "success" | "error" | "warning" | "info" = "success"
  ) {
    await triggerAction();

    const toast = this.page.locator('[data-testid="toast"]');

    // Toast should appear
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Toast should contain expected message
    await expect(toast).toContainText(expectedMessage);

    // Toast should have correct type
    await expect(toast).toHaveClass(new RegExp(`toast-${type}`));

    // Toast should disappear after timeout
    await expect(toast).toBeHidden({ timeout: 10000 });
  }
}
