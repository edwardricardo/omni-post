/**
 * @file analytics.spec.ts
 * @description Tests for Analytics Dashboard
 * @layer infrastructure
 */
import { test, expect } from "../config/test-setup.js";
// Page type not used directly '../pages/AnalyticsPage';
// Page type not used directly '../pages/DashboardPage';
// Page type not used directly '../pages/AuthPage';

/**
 * Analytics E2E Tests
 * Tests analytics dashboard functionality, metrics viewing, and report generation
 */

test.describe("Analytics Dashboard", () => {
  let analyticsPage: AnalyticsPage;
  let dashboardPage: DashboardPage;
  let authPage: AuthPage;

  test.beforeEach(async ({ page, testData }) => {
    analyticsPage = new AnalyticsPage(page);
    dashboardPage = new DashboardPage(page);
    authPage = new AuthPage(page);

    // Login and setup test data
    await authPage.goToLogin();
    await authPage.loginWithValidCredentials();
    await dashboardPage.expectDashboardToBeLoaded();

    // Create test data for analytics
    const project = await testData.createTestProject();
    const _channel = await testData.createTestChannel(project.id, "twitter");
    await testData.createTestPost(project.id, "Analytics test post");
  });

  test.describe("Analytics Overview", () => {
    test("should load analytics dashboard", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.expectAnalyticsPageToBeLoaded();

      await analyticsPage.expectMetricsToBeVisible();
      await analyticsPage.expectChartsToBeVisible();
    });

    test("should display key metrics cards", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      const metrics = await analyticsPage.getMetricsOverview();

      expect(metrics.totalPosts).toBeTruthy();
      expect(metrics.totalEngagement).toBeTruthy();
      expect(metrics.totalReach).toBeTruthy();
      expect(metrics.avgEngagementRate).toBeTruthy();
    });

    test("should show charts and graphs", async () => {
      await analyticsPage.goToAnalytics();

      await analyticsPage.expectChartsToBeVisible();
      await analyticsPage.waitForChartsToLoad();

      // Charts should be interactive
      await expect(analyticsPage.engagementChart).toBeVisible();
      await expect(analyticsPage.reachChart).toBeVisible();
      await expect(analyticsPage.postPerformanceChart).toBeVisible();
    });

    test("should measure analytics load performance", async () => {
      const loadTime = await analyticsPage.measurePageLoadTime();
      expect(loadTime).toBeLessThan(5000); // Should load within 5 seconds

      await analyticsPage.goToAnalytics();
      const chartLoadTime = await analyticsPage.measureChartLoadTime();
      expect(chartLoadTime).toBeLessThan(3000); // Charts should load within 3 seconds
    });
  });

  test.describe("Date Range Selection", () => {
    test("should filter by predefined date ranges", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      // Test different date ranges
      const dateRanges = ["today", "yesterday", "last-7-days", "last-30-days"];

      for (const range of dateRanges) {
        await analyticsPage.selectDateRange(range as any);
        await analyticsPage.waitForAnalyticsToLoad();

        const currentRange = await analyticsPage.getCurrentDateRange();
        expect(currentRange.toLowerCase()).toContain(range.replace("-", " "));
      }
    });

    test("should allow custom date range selection", async () => {
      await analyticsPage.goToAnalytics();

      const startDate = "2024-01-01";
      const endDate = "2024-01-31";

      await analyticsPage.setCustomDateRange(startDate, endDate);
      await analyticsPage.waitForAnalyticsToLoad();

      const currentRange = await analyticsPage.getCurrentDateRange();
      expect(currentRange).toContain("Jan");
    });

    test("should validate date range constraints", async ({ page }) => {
      await analyticsPage.goToAnalytics();

      // Try to set end date before start date
      await analyticsPage.dateRangeSelector.click();
      await analyticsPage.customDateRangeButton.click();

      await analyticsPage.startDateInput.fill("2024-01-31");
      await analyticsPage.endDateInput.fill("2024-01-01");
      await analyticsPage.applyDateRangeButton.click();

      // Should show validation error
      await expect(page.locator('[data-testid="date-range-error"]')).toBeVisible();
    });
  });

  test.describe("Filtering and Segmentation", () => {
    test("should filter by platform", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      await analyticsPage.filterByPlatform("twitter");
      await analyticsPage.waitForAnalyticsToLoad();

      // Metrics should update based on platform filter
      const metrics = await analyticsPage.getMetricsOverview();
      expect(metrics).toBeTruthy();
    });

    test("should filter by post type", async () => {
      await analyticsPage.goToAnalytics();

      await analyticsPage.filterByPostType("image");
      await analyticsPage.waitForAnalyticsToLoad();

      // Verify filter is applied
      const platformFilter = await analyticsPage.postTypeFilter.inputValue();
      expect(platformFilter).toBe("image");
    });

    test("should filter by specific channels", async ({ testData }) => {
      const project = await testData.createTestProject();
      const _channel = await testData.createTestChannel(project.id, "twitter");

      await analyticsPage.goToAnalytics();
      await analyticsPage.filterByChannel(channel.id);
      await analyticsPage.waitForAnalyticsToLoad();

      // Analytics should show data for specific channel only
      const metrics = await analyticsPage.getMetricsOverview();
      expect(metrics).toBeTruthy();
    });

    test("should reset all filters", async () => {
      await analyticsPage.goToAnalytics();

      // Apply multiple filters
      await analyticsPage.filterByPlatform("twitter");
      await analyticsPage.filterByPostType("image");

      // Reset filters
      await analyticsPage.resetAllFilters();
      await analyticsPage.waitForAnalyticsToLoad();

      // Filters should be cleared
      const platformFilter = await analyticsPage.platformFilter.inputValue();
      const postTypeFilter = await analyticsPage.postTypeFilter.inputValue();

      expect(platformFilter).toBe("");
      expect(postTypeFilter).toBe("");
    });
  });

  test.describe("Chart Interactions", () => {
    test("should switch chart types", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      const chartTypes = ["line", "bar", "area"];

      for (const chartType of chartTypes) {
        await analyticsPage.switchToChartType(chartType as any);
        await analyticsPage.waitForChartsToLoad();

        // Chart should reflect the new type
        const chartElement = analyticsPage.engagementChart;
        await expect(chartElement).toBeVisible();
      }
    });

    test("should change chart timeline", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      const timelines = ["daily", "weekly", "monthly"];

      for (const timeline of timelines) {
        await analyticsPage.setChartTimeline(timeline as any);
        await analyticsPage.waitForChartsToLoad();

        // Verify timeline is applied
        const timelineSelector = await analyticsPage.chartTimelineSelector.inputValue();
        expect(timelineSelector).toBe(timeline);
      }
    });

    test("should expand charts to fullscreen", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      await analyticsPage.expandChartFullscreen('[data-testid="engagement-chart"]');
      await analyticsPage.expectElementToBeVisible('[data-testid="fullscreen-chart-modal"]');

      await analyticsPage.closeFullscreenChart();
      await analyticsPage.expectElementToBeHidden('[data-testid="fullscreen-chart-modal"]');
    });

    test("should handle chart hover interactions", async ({ page }) => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      // Hover over chart to show tooltips
      await analyticsPage.engagementChart.hover();

      // Tooltip should appear
      await expect(page.locator('[data-testid="chart-tooltip"]')).toBeVisible();
    });
  });

  test.describe("Platform-Specific Analytics", () => {
    test("should show Twitter-specific metrics", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.switchToPlatformMetrics("twitter");

      const twitterMetrics = await analyticsPage.getPlatformMetrics("twitter");

      expect(twitterMetrics.followers).toBeTruthy();
      expect(twitterMetrics.posts).toBeTruthy();
      expect(twitterMetrics.engagement).toBeTruthy();
    });

    test("should show Instagram-specific metrics", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.switchToPlatformMetrics("instagram");

      const instagramMetrics = await analyticsPage.getPlatformMetrics("instagram");

      expect(instagramMetrics.followers).toBeTruthy();
      expect(instagramMetrics.posts).toBeTruthy();
    });

    test("should compare metrics across platforms", async () => {
      await analyticsPage.goToAnalytics();

      const twitterMetrics = await analyticsPage.getPlatformMetrics("twitter");
      const instagramMetrics = await analyticsPage.getPlatformMetrics("instagram");

      // Should be able to get metrics for both platforms
      expect(twitterMetrics).toBeTruthy();
      expect(instagramMetrics).toBeTruthy();
    });
  });

  test.describe("Top Performing Content", () => {
    test("should display top performing posts", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.expectTopPostsToBeVisible();

      const topPosts = await analyticsPage.getTopPosts();

      expect(topPosts.length).toBeGreaterThan(0);
      expect(topPosts[0].content).toBeTruthy();
      expect(topPosts[0].engagement).toBeTruthy();
    });

    test("should navigate to post details", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.expectTopPostsToBeVisible();

      await analyticsPage.viewTopPostDetails(0);

      // Should navigate to post analytics page
      await analyticsPage.expectUrl(/\/posts\/.*\/analytics/);
    });

    test("should sort top posts by different metrics", async ({ page }) => {
      await analyticsPage.goToAnalytics();

      // Sort by engagement
      await page.locator('[data-testid="sort-by-engagement"]').click();
      await analyticsPage.waitForAnalyticsToLoad();

      // Sort by reach
      await page.locator('[data-testid="sort-by-reach"]').click();
      await analyticsPage.waitForAnalyticsToLoad();

      // Top posts should reorder
      const topPosts = await analyticsPage.getTopPosts();
      expect(topPosts.length).toBeGreaterThan(0);
    });
  });

  test.describe("Audience Insights", () => {
    test("should display audience demographics", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.expectAudienceInsightsToBeVisible();

      const insights = await analyticsPage.getAudienceInsights();

      expect(insights.demographics).toBeTruthy();
      expect(insights.geography).toBeTruthy();
      expect(insights.activity).toBeTruthy();
    });

    test("should show audience geography distribution", async () => {
      await analyticsPage.goToAnalytics();

      await analyticsPage.viewAudienceGeography();
      await analyticsPage.expectElementToBeVisible('[data-testid="geography-chart"]');

      const geographyData = await analyticsPage.getAudienceInsights();
      expect(geographyData.geography.length).toBeGreaterThan(0);
    });

    test("should display audience activity patterns", async () => {
      await analyticsPage.goToAnalytics();

      await analyticsPage.viewAudienceActivity();
      await analyticsPage.expectElementToBeVisible('[data-testid="activity-chart"]');

      const activityData = await analyticsPage.getAudienceInsights();
      expect(activityData.activity.length).toBeGreaterThan(0);
    });
  });

  test.describe("Report Generation", () => {
    test("should generate summary report", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.expectReportsSectionToBeVisible();

      await analyticsPage.generateReport("summary");

      // Should show report generation progress
      await analyticsPage.expectElementToBeVisible('[data-testid="report-progress"]');
      await analyticsPage.expectElementToBeHidden('[data-testid="report-progress"]');
    });

    test("should schedule recurring reports", async () => {
      await analyticsPage.goToAnalytics();

      await analyticsPage.scheduleReport("detailed", "weekly");
      await analyticsPage.expectToast("Report scheduled successfully");
    });

    test("should download reports in different formats", async () => {
      await analyticsPage.goToAnalytics();

      // Generate report first
      await analyticsPage.generateReport("summary");

      // Download as PDF
      const pdfDownload = await analyticsPage.downloadReport("pdf");
      expect(pdfDownload.suggestedFilename()).toContain(".pdf");

      // Download as CSV
      const csvDownload = await analyticsPage.downloadReport("csv");
      expect(csvDownload.suggestedFilename()).toContain(".csv");
    });

    test("should handle report generation errors", async ({ apiHelper }) => {
      await analyticsPage.goToAnalytics();

      // Mock report generation failure
      await apiHelper.mockApiResponse(
        "/api/analytics/reports",
        { error: "Generation failed" },
        500
      );

      await analyticsPage.generateReport("summary");
      await analyticsPage.expectError("Failed to generate report");
    });
  });

  test.describe("Data Export", () => {
    test("should export analytics data", async () => {
      await analyticsPage.goToAnalytics();

      const csvDownload = await analyticsPage.exportAnalytics("csv");
      expect(csvDownload.suggestedFilename()).toContain(".csv");
    });

    test("should export data with current filters applied", async () => {
      await analyticsPage.goToAnalytics();

      // Apply filters
      await analyticsPage.filterByPlatform("twitter");
      await analyticsPage.selectDateRange("last-30-days");

      const download = await analyticsPage.exportAnalytics("xlsx");
      expect(download.suggestedFilename()).toContain(".xlsx");
    });
  });

  test.describe("Real-time Updates", () => {
    test("should refresh analytics data", async () => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      const refreshTime = await analyticsPage.measureDataRefreshTime();
      expect(refreshTime).toBeLessThan(5000); // Should refresh within 5 seconds
    });

    test("should show last updated timestamp", async ({ page }) => {
      await analyticsPage.goToAnalytics();

      await expect(page.locator('[data-testid="last-updated"]')).toBeVisible();

      await analyticsPage.refreshAnalytics();

      // Timestamp should update
      await expect(page.locator('[data-testid="last-updated"]')).toContainText(/Updated/);
    });
  });

  test.describe("Error Handling", () => {
    test("should handle API errors gracefully", async ({ apiHelper }) => {
      // Mock API error
      await apiHelper.mockApiResponse("/api/analytics", { error: "Server error" }, 500);

      await analyticsPage.goToAnalytics();
      await analyticsPage.expectError("Failed to load analytics data");
    });

    test("should handle empty data states", async ({ apiHelper }) => {
      // Mock empty data response
      await apiHelper.mockApiResponse("/api/analytics", {
        metrics: { totalPosts: 0, totalEngagement: 0 },
        charts: [],
        topPosts: [],
      });

      await analyticsPage.goToAnalytics();

      // Should show empty state
      await analyticsPage.expectElementToBeVisible('[data-testid="empty-analytics-state"]');
    });

    test("should handle network timeouts", async ({ page, apiHelper }) => {
      // Mock slow response
      await apiHelper.mockApiResponse("/api/analytics", {}, 200);
      await page.route("**/api/analytics", (route) => {
        setTimeout(() => route.fulfill({ status: 200, body: "{}" }), 10000);
      });

      await analyticsPage.goToAnalytics();

      // Should show loading state
      await analyticsPage.expectElementToBeVisible('[data-testid="analytics-loading"]');
    });
  });

  test.describe("Accessibility", () => {
    test("analytics dashboard should be accessible", async ({ axeBuilder }) => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      const accessibilityScanResults = await axeBuilder.analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("should support keyboard navigation", async ({ page }) => {
      await analyticsPage.goToAnalytics();

      // Tab through interactive elements
      await page.keyboard.press("Tab"); // Date range selector
      await expect(analyticsPage.dateRangeSelector).toBeFocused();

      // Continue tabbing through filters
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Should reach chart controls
      const focusedElement = await page.locator(":focus").getAttribute("data-testid");
      expect(focusedElement).toBeTruthy();
    });

    test("charts should have proper ARIA labels", async ({ page: _page }) => {
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      // Charts should have accessible labels
      await expect(analyticsPage.engagementChart).toHaveAttribute("aria-label");
      await expect(analyticsPage.reachChart).toHaveAttribute("aria-label");
    });
  });

  test.describe("Mobile Responsiveness", () => {
    test("should work on mobile devices", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await analyticsPage.goToAnalytics();
      await analyticsPage.expectAnalyticsPageToBeLoaded();

      // Charts should be responsive
      await analyticsPage.expectChartsToBeVisible();
    });

    test("should handle touch interactions on charts", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForChartsToLoad();

      // Test touch interactions
      await analyticsPage.engagementChart.tap();

      // Should show mobile-optimized tooltips
      await expect(page.locator('[data-testid="mobile-chart-tooltip"]')).toBeVisible();
    });
  });

  test.describe("Performance Monitoring", () => {
    test("should load large datasets efficiently", async ({ testData }) => {
      // Create large dataset
      const project = await testData.createTestProject();
      for (let i = 0; i < 100; i++) {
        await testData.createTestPost(project.id, `Test post ${i}`);
      }

      const startTime = Date.now();
      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();
      const loadTime = Date.now() - startTime;

      expect(loadTime).toBeLessThan(10000); // Should handle large datasets within 10 seconds
    });

    test("should maintain performance with complex filters", async () => {
      await analyticsPage.goToAnalytics();

      const startTime = Date.now();

      // Apply multiple complex filters
      await analyticsPage.filterByPlatform("twitter");
      await analyticsPage.filterByPostType("image");
      await analyticsPage.setCustomDateRange("2024-01-01", "2024-12-31");

      await analyticsPage.waitForAnalyticsToLoad();
      const filterTime = Date.now() - startTime;

      expect(filterTime).toBeLessThan(5000); // Complex filtering should complete within 5 seconds
    });
  });
});
