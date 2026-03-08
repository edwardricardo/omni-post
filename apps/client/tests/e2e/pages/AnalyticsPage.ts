// Page type not used directly '@playwright/test';
// Page type not used directly './BasePage';

/**
 * Analytics Page Object Model
 * Handles analytics dashboard interactions, metrics viewing, and report generation
 */

export class AnalyticsPage extends BasePage {
  // Page header
  get analyticsHeader(): Locator {
    return this.page.locator('[data-testid="analytics-header"]');
  }

  get pageTitle(): Locator {
    return this.page.locator('[data-testid="analytics-title"]');
  }

  get exportButton(): Locator {
    return this.page.locator('[data-testid="export-analytics-button"]');
  }

  get refreshButton(): Locator {
    return this.page.locator('[data-testid="refresh-analytics-button"]');
  }

  // Date range selector
  get dateRangeSelector(): Locator {
    return this.page.locator('[data-testid="date-range-selector"]');
  }

  get dateRangeDropdown(): Locator {
    return this.page.locator('[data-testid="date-range-dropdown"]');
  }

  get customDateRangeButton(): Locator {
    return this.page.locator('[data-testid="custom-date-range"]');
  }

  get startDateInput(): Locator {
    return this.page.locator('[data-testid="start-date-input"]');
  }

  get endDateInput(): Locator {
    return this.page.locator('[data-testid="end-date-input"]');
  }

  get applyDateRangeButton(): Locator {
    return this.page.locator('[data-testid="apply-date-range"]');
  }

  // Filter controls
  get platformFilter(): Locator {
    return this.page.locator('[data-testid="platform-filter"]');
  }

  get postTypeFilter(): Locator {
    return this.page.locator('[data-testid="post-type-filter"]');
  }

  get channelFilter(): Locator {
    return this.page.locator('[data-testid="channel-filter"]');
  }

  get resetFiltersButton(): Locator {
    return this.page.locator('[data-testid="reset-filters"]');
  }

  // Key metrics cards
  get metricsOverview(): Locator {
    return this.page.locator('[data-testid="metrics-overview"]');
  }

  get totalPostsMetric(): Locator {
    return this.page.locator('[data-testid="total-posts-metric"]');
  }

  get totalEngagementMetric(): Locator {
    return this.page.locator('[data-testid="total-engagement-metric"]');
  }

  get totalReachMetric(): Locator {
    return this.page.locator('[data-testid="total-reach-metric"]');
  }

  get avgEngagementRateMetric(): Locator {
    return this.page.locator('[data-testid="avg-engagement-rate-metric"]');
  }

  get followerGrowthMetric(): Locator {
    return this.page.locator('[data-testid="follower-growth-metric"]');
  }

  get clickThroughRateMetric(): Locator {
    return this.page.locator('[data-testid="click-through-rate-metric"]');
  }

  // Charts and graphs
  get engagementChart(): Locator {
    return this.page.locator('[data-testid="engagement-chart"]');
  }

  get reachChart(): Locator {
    return this.page.locator('[data-testid="reach-chart"]');
  }

  get postPerformanceChart(): Locator {
    return this.page.locator('[data-testid="post-performance-chart"]');
  }

  get platformComparisonChart(): Locator {
    return this.page.locator('[data-testid="platform-comparison-chart"]');
  }

  get audienceGrowthChart(): Locator {
    return this.page.locator('[data-testid="audience-growth-chart"]');
  }

  get bestPostingTimesChart(): Locator {
    return this.page.locator('[data-testid="best-posting-times-chart"]');
  }

  // Chart controls
  get chartTypeSelector(): Locator {
    return this.page.locator('[data-testid="chart-type-selector"]');
  }

  get chartTimelineSelector(): Locator {
    return this.page.locator('[data-testid="chart-timeline-selector"]');
  }

  get chartFullscreenButton(): Locator {
    return this.page.locator('[data-testid="chart-fullscreen"]');
  }

  // Top performing content
  get topPostsSection(): Locator {
    return this.page.locator('[data-testid="top-posts-section"]');
  }

  get topPostItems(): Locator {
    return this.page.locator('[data-testid="top-post-item"]');
  }

  get topPostMetrics(): Locator {
    return this.page.locator('[data-testid="top-post-metrics"]');
  }

  get viewTopPostButton(): Locator {
    return this.page.locator('[data-testid="view-top-post"]');
  }

  // Platform-specific metrics
  get platformTabs(): Locator {
    return this.page.locator('[data-testid="platform-tabs"]');
  }

  get twitterMetrics(): Locator {
    return this.page.locator('[data-testid="twitter-metrics"]');
  }

  get instagramMetrics(): Locator {
    return this.page.locator('[data-testid="instagram-metrics"]');
  }

  get facebookMetrics(): Locator {
    return this.page.locator('[data-testid="facebook-metrics"]');
  }

  get linkedinMetrics(): Locator {
    return this.page.locator('[data-testid="linkedin-metrics"]');
  }

  // Audience insights
  get audienceInsights(): Locator {
    return this.page.locator('[data-testid="audience-insights"]');
  }

  get audienceDemographics(): Locator {
    return this.page.locator('[data-testid="audience-demographics"]');
  }

  get audienceGeography(): Locator {
    return this.page.locator('[data-testid="audience-geography"]');
  }

  get audienceActivity(): Locator {
    return this.page.locator('[data-testid="audience-activity"]');
  }

  // Reports section
  get reportsSection(): Locator {
    return this.page.locator('[data-testid="reports-section"]');
  }

  get generateReportButton(): Locator {
    return this.page.locator('[data-testid="generate-report"]');
  }

  get reportTypeSelect(): Locator {
    return this.page.locator('[data-testid="report-type-select"]');
  }

  get scheduleReportButton(): Locator {
    return this.page.locator('[data-testid="schedule-report"]');
  }

  get downloadReportButton(): Locator {
    return this.page.locator('[data-testid="download-report"]');
  }

  // Navigation methods
  async goToAnalytics() {
    await this.goto("/dashboard/analytics");
  }

  // Date range methods
  async selectDateRange(
    range: "today" | "yesterday" | "last-7-days" | "last-30-days" | "last-90-days" | "custom"
  ) {
    await this.dateRangeSelector.click();
    await this.page.locator(`[data-testid="date-range-${range}"]`).click();
    await this.waitForAnalyticsToLoad();
  }

  async setCustomDateRange(startDate: string, endDate: string) {
    await this.dateRangeSelector.click();
    await this.customDateRangeButton.click();

    await this.startDateInput.fill(startDate);
    await this.endDateInput.fill(endDate);
    await this.applyDateRangeButton.click();

    await this.waitForAnalyticsToLoad();
  }

  async getCurrentDateRange(): Promise<string> {
    return (await this.dateRangeSelector.textContent()) || "";
  }

  // Filter methods
  async filterByPlatform(platform: string) {
    await this.platformFilter.selectOption(platform);
    await this.waitForAnalyticsToLoad();
  }

  async filterByPostType(postType: string) {
    await this.postTypeFilter.selectOption(postType);
    await this.waitForAnalyticsToLoad();
  }

  async filterByChannel(channelId: string) {
    await this.channelFilter.selectOption(channelId);
    await this.waitForAnalyticsToLoad();
  }

  async resetAllFilters() {
    await this.resetFiltersButton.click();
    await this.waitForAnalyticsToLoad();
  }

  // Metrics methods
  async getMetricsOverview() {
    await this.expectElementToBeVisible('[data-testid="metrics-overview"]');

    const metrics = {
      totalPosts: await this.totalPostsMetric.textContent(),
      totalEngagement: await this.totalEngagementMetric.textContent(),
      totalReach: await this.totalReachMetric.textContent(),
      avgEngagementRate: await this.avgEngagementRateMetric.textContent(),
      followerGrowth: await this.followerGrowthMetric.textContent(),
      clickThroughRate: await this.clickThroughRateMetric.textContent(),
    };

    return metrics;
  }

  async waitForMetricsToLoad() {
    await this.expectElementToBeVisible('[data-testid="metrics-overview"]');
    await this.waitForElementToBeHidden('[data-testid="metrics-loading"]');
  }

  // Chart methods
  async switchToChartType(chartType: "line" | "bar" | "area") {
    await this.chartTypeSelector.selectOption(chartType);
    await this.waitForChartsToLoad();
  }

  async setChartTimeline(timeline: "hourly" | "daily" | "weekly" | "monthly") {
    await this.chartTimelineSelector.selectOption(timeline);
    await this.waitForChartsToLoad();
  }

  async expandChartFullscreen(chartSelector: string) {
    await this.page.locator(`${chartSelector} [data-testid="chart-fullscreen"]`).click();
    await this.expectElementToBeVisible('[data-testid="fullscreen-chart-modal"]');
  }

  async closeFullscreenChart() {
    await this.page.locator('[data-testid="close-fullscreen-chart"]').click();
    await this.expectElementToBeHidden('[data-testid="fullscreen-chart-modal"]');
  }

  async waitForChartsToLoad() {
    await this.expectElementToBeVisible('[data-testid="engagement-chart"]');
    await this.expectElementToBeVisible('[data-testid="reach-chart"]');
    await this.waitForElementToBeHidden('[data-testid="charts-loading"]');
  }

  // Top posts methods
  async getTopPosts() {
    await this.expectElementToBeVisible('[data-testid="top-posts-section"]');

    const items = await this.topPostItems.all();
    const topPosts = [];

    for (const item of items) {
      const content = await item.locator('[data-testid="post-content-preview"]').textContent();
      const engagement = await item.locator('[data-testid="post-engagement"]').textContent();
      const reach = await item.locator('[data-testid="post-reach"]').textContent();
      const date = await item.locator('[data-testid="post-date"]').textContent();

      topPosts.push({ content, engagement, reach, date });
    }

    return topPosts;
  }

  async viewTopPostDetails(index: number = 0) {
    const items = await this.topPostItems.all();
    if (items[index]) {
      await items[index].locator('[data-testid="view-top-post"]').click();
      await this.page.waitForURL(/\/posts\/.*\/analytics/);
    }
  }

  // Platform-specific methods
  async switchToPlatformMetrics(platform: "twitter" | "instagram" | "facebook" | "linkedin") {
    await this.page.locator(`[data-testid="platform-tab-${platform}"]`).click();
    await this.expectElementToBeVisible(`[data-testid="${platform}-metrics"]`);
    await this.waitForAnalyticsToLoad();
  }

  async getPlatformMetrics(platform: string) {
    await this.switchToPlatformMetrics(platform as any);

    const metricsSection = this.page.locator(`[data-testid="${platform}-metrics"]`);
    const metrics = {
      followers: await metricsSection.locator('[data-testid="followers-count"]').textContent(),
      posts: await metricsSection.locator('[data-testid="platform-posts-count"]').textContent(),
      engagement: await metricsSection.locator('[data-testid="platform-engagement"]').textContent(),
      reach: await metricsSection.locator('[data-testid="platform-reach"]').textContent(),
    };

    return metrics;
  }

  // Audience insights methods
  async viewAudienceDemographics() {
    await this.audienceDemographics.click();
    await this.expectElementToBeVisible('[data-testid="demographics-chart"]');
  }

  async viewAudienceGeography() {
    await this.audienceGeography.click();
    await this.expectElementToBeVisible('[data-testid="geography-chart"]');
  }

  async viewAudienceActivity() {
    await this.audienceActivity.click();
    await this.expectElementToBeVisible('[data-testid="activity-chart"]');
  }

  async getAudienceInsights() {
    const insights = {
      demographics: await this.getAudienceDemographicsData(),
      geography: await this.getAudienceGeographyData(),
      activity: await this.getAudienceActivityData(),
    };

    return insights;
  }

  private async getAudienceDemographicsData() {
    await this.viewAudienceDemographics();
    // Extract demographics data from chart
    const ageGroups = await this.page.locator('[data-testid="age-group-data"]').all();
    const demographics = [];

    for (const group of ageGroups) {
      const label = await group.locator('[data-testid="age-label"]').textContent();
      const percentage = await group.locator('[data-testid="age-percentage"]').textContent();
      demographics.push({ label, percentage });
    }

    return demographics;
  }

  private async getAudienceGeographyData() {
    await this.viewAudienceGeography();
    // Extract geography data from chart
    const locations = await this.page.locator('[data-testid="location-data"]').all();
    const geography = [];

    for (const location of locations) {
      const country = await location.locator('[data-testid="country-name"]').textContent();
      const percentage = await location.locator('[data-testid="country-percentage"]').textContent();
      geography.push({ country, percentage });
    }

    return geography;
  }

  private async getAudienceActivityData() {
    await this.viewAudienceActivity();
    // Extract activity data from chart
    const timeSlots = await this.page.locator('[data-testid="activity-time-slot"]').all();
    const activity = [];

    for (const slot of timeSlots) {
      const time = await slot.locator('[data-testid="time-label"]').textContent();
      const activity_level = await slot.locator('[data-testid="activity-level"]').textContent();
      activity.push({ time, activity_level });
    }

    return activity;
  }

  // Reports methods
  async generateReport(reportType: "summary" | "detailed" | "performance" | "audience") {
    await this.reportTypeSelect.selectOption(reportType);
    await this.generateReportButton.click();
    await this.expectToast("Report generation started");
    await this.waitForReportGeneration();
  }

  async scheduleReport(reportType: string, frequency: "daily" | "weekly" | "monthly") {
    await this.reportTypeSelect.selectOption(reportType);
    await this.scheduleReportButton.click();

    // Configure scheduling in modal
    await this.page.locator('[data-testid="report-frequency-select"]').selectOption(frequency);
    await this.page.locator('[data-testid="confirm-schedule-report"]').click();

    await this.expectToast("Report scheduled successfully");
  }

  async downloadReport(format: "pdf" | "csv" | "xlsx" = "pdf") {
    await this.page.locator(`[data-testid="download-format-${format}"]`).click();
    await this.downloadReportButton.click();

    // Wait for download to start
    const downloadPromise = this.page.waitForEvent("download");
    const download = await downloadPromise;

    return download;
  }

  private async waitForReportGeneration() {
    await this.expectElementToBeVisible('[data-testid="report-progress"]');
    await this.expectElementToBeHidden('[data-testid="report-progress"]');
    await this.expectElementToBeVisible('[data-testid="download-report-button"]');
  }

  // Data refresh methods
  async refreshAnalytics() {
    await this.refreshButton.click();
    await this.expectToast("Analytics data refreshed");
    await this.waitForAnalyticsToLoad();
  }

  async waitForAnalyticsToLoad() {
    await this.waitForPageLoad();
    await this.waitForMetricsToLoad();
    await this.waitForChartsToLoad();
  }

  // Export methods
  async exportAnalytics(format: "csv" | "xlsx" | "pdf" = "csv") {
    await this.exportButton.click();
    await this.page.locator(`[data-testid="export-format-${format}"]`).click();

    const downloadPromise = this.page.waitForEvent("download");
    await this.page.locator('[data-testid="confirm-export"]').click();
    const download = await downloadPromise;

    return download;
  }

  // Validation methods
  async expectAnalyticsPageToBeLoaded() {
    await this.expectElementToBeVisible('[data-testid="analytics-header"]');
    await this.expectElementToBeVisible('[data-testid="metrics-overview"]');
    await this.expectElementToBeVisible('[data-testid="engagement-chart"]');
  }

  async expectMetricsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="total-posts-metric"]');
    await this.expectElementToBeVisible('[data-testid="total-engagement-metric"]');
    await this.expectElementToBeVisible('[data-testid="total-reach-metric"]');
    await this.expectElementToBeVisible('[data-testid="avg-engagement-rate-metric"]');
  }

  async expectChartsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="engagement-chart"]');
    await this.expectElementToBeVisible('[data-testid="reach-chart"]');
    await this.expectElementToBeVisible('[data-testid="post-performance-chart"]');
  }

  async expectTopPostsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="top-posts-section"]');
    await this.expectElementToBeVisible('[data-testid="top-post-item"]');
  }

  async expectAudienceInsightsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="audience-insights"]');
    await this.expectElementToBeVisible('[data-testid="audience-demographics"]');
  }

  async expectReportsSectionToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="reports-section"]');
    await this.expectElementToBeVisible('[data-testid="generate-report"]');
  }

  // Performance testing helpers
  async measureChartLoadTime(): Promise<number> {
    const startTime = Date.now();
    await this.waitForChartsToLoad();
    const endTime = Date.now();
    return endTime - startTime;
  }

  async measureDataRefreshTime(): Promise<number> {
    const startTime = Date.now();
    await this.refreshAnalytics();
    const endTime = Date.now();
    return endTime - startTime;
  }
}
