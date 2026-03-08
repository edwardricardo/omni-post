// Page type not used directly '@playwright/test';
// Page type not used directly './BasePage';

/**
 * Dashboard Page Object Model
 * Handles main dashboard navigation and overview functionality
 */

export class DashboardPage extends BasePage {
  // Header elements
  get dashboardHeader(): Locator {
    return this.page.locator('[data-testid="dashboard-header"]');
  }

  get userMenuTrigger(): Locator {
    return this.page.locator('[data-testid="user-menu-trigger"]');
  }

  get userMenuDropdown(): Locator {
    return this.page.locator('[data-testid="user-menu-dropdown"]');
  }

  get logoutButton(): Locator {
    return this.page.locator('[data-testid="logout-button"]');
  }

  get profileLink(): Locator {
    return this.page.locator('[data-testid="profile-link"]');
  }

  get settingsLink(): Locator {
    return this.page.locator('[data-testid="settings-link"]');
  }

  // Navigation elements
  get sidebarNav(): Locator {
    return this.page.locator('[data-testid="sidebar-nav"]');
  }

  get dashboardNavLink(): Locator {
    return this.page.locator('[data-testid="nav-dashboard"]');
  }

  get postsNavLink(): Locator {
    return this.page.locator('[data-testid="nav-posts"]');
  }

  get analyticsNavLink(): Locator {
    return this.page.locator('[data-testid="nav-analytics"]');
  }

  get channelsNavLink(): Locator {
    return this.page.locator('[data-testid="nav-channels"]');
  }

  get templatesNavLink(): Locator {
    return this.page.locator('[data-testid="nav-templates"]');
  }

  get schedulingNavLink(): Locator {
    return this.page.locator('[data-testid="nav-scheduling"]');
  }

  // Project selector
  get projectSelector(): Locator {
    return this.page.locator('[data-testid="project-selector"]');
  }

  get currentProjectName(): Locator {
    return this.page.locator('[data-testid="current-project-name"]');
  }

  get projectDropdown(): Locator {
    return this.page.locator('[data-testid="project-dropdown"]');
  }

  get createProjectButton(): Locator {
    return this.page.locator('[data-testid="create-project-button"]');
  }

  // Dashboard overview widgets
  get overviewStats(): Locator {
    return this.page.locator('[data-testid="overview-stats"]');
  }

  get totalPostsCount(): Locator {
    return this.page.locator('[data-testid="total-posts-count"]');
  }

  get scheduledPostsCount(): Locator {
    return this.page.locator('[data-testid="scheduled-posts-count"]');
  }

  get publishedPostsCount(): Locator {
    return this.page.locator('[data-testid="published-posts-count"]');
  }

  get connectedChannelsCount(): Locator {
    return this.page.locator('[data-testid="connected-channels-count"]');
  }

  // Recent activity
  get recentActivity(): Locator {
    return this.page.locator('[data-testid="recent-activity"]');
  }

  get activityItems(): Locator {
    return this.page.locator('[data-testid="activity-item"]');
  }

  // Quick actions
  get quickActions(): Locator {
    return this.page.locator('[data-testid="quick-actions"]');
  }

  get createPostButton(): Locator {
    return this.page.locator('[data-testid="create-post-button"]');
  }

  get connectChannelButton(): Locator {
    return this.page.locator('[data-testid="connect-channel-button"]');
  }

  get schedulePostButton(): Locator {
    return this.page.locator('[data-testid="schedule-post-button"]');
  }

  // Upcoming posts widget
  get upcomingPosts(): Locator {
    return this.page.locator('[data-testid="upcoming-posts"]');
  }

  get upcomingPostItems(): Locator {
    return this.page.locator('[data-testid="upcoming-post-item"]');
  }

  // Channel status widget
  get channelStatus(): Locator {
    return this.page.locator('[data-testid="channel-status"]');
  }

  get channelStatusItems(): Locator {
    return this.page.locator('[data-testid="channel-status-item"]');
  }

  // Analytics preview
  get analyticsPreview(): Locator {
    return this.page.locator('[data-testid="analytics-preview"]');
  }

  get engagementChart(): Locator {
    return this.page.locator('[data-testid="engagement-chart"]');
  }

  get viewFullAnalyticsButton(): Locator {
    return this.page.locator('[data-testid="view-full-analytics-button"]');
  }

  // Navigation methods
  async goToDashboard() {
    await this.goto("/dashboard");
  }

  async navigateToPosts() {
    await this.postsNavLink.click();
    await this.page.waitForURL("/dashboard/posts");
  }

  async navigateToAnalytics() {
    await this.analyticsNavLink.click();
    await this.page.waitForURL("/dashboard/analytics");
  }

  async navigateToChannels() {
    await this.channelsNavLink.click();
    await this.page.waitForURL("/dashboard/channels");
  }

  async navigateToTemplates() {
    await this.templatesNavLink.click();
    await this.page.waitForURL("/dashboard/templates");
  }

  async navigateToScheduling() {
    await this.schedulingNavLink.click();
    await this.page.waitForURL("/dashboard/scheduling");
  }

  // User menu actions
  async openUserMenu() {
    await this.userMenuTrigger.click();
    await this.expectElementToBeVisible('[data-testid="user-menu-dropdown"]');
  }

  async goToProfile() {
    await this.openUserMenu();
    await this.profileLink.click();
    await this.page.waitForURL("/profile");
  }

  async goToSettings() {
    await this.openUserMenu();
    await this.settingsLink.click();
    await this.page.waitForURL("/settings");
  }

  async logout() {
    await this.openUserMenu();
    await this.logoutButton.click();
    await this.page.waitForURL("/login");
  }

  // Project management
  async openProjectSelector() {
    await this.projectSelector.click();
    await this.expectElementToBeVisible('[data-testid="project-dropdown"]');
  }

  async selectProject(projectName: string) {
    await this.openProjectSelector();
    await this.page.locator(`[data-testid="project-option-${projectName}"]`).click();
    await this.waitForProjectToLoad(projectName);
  }

  async createNewProject(projectName: string, description?: string) {
    await this.openProjectSelector();
    await this.createProjectButton.click();

    // Fill project creation form
    await this.fillInput('[data-testid="project-name-input"]', projectName);
    if (description) {
      await this.fillInput('[data-testid="project-description-input"]', description);
    }

    await this.submitForm('[data-testid="create-project-submit"]');
    await this.waitForProjectToLoad(projectName);
  }

  async waitForProjectToLoad(projectName: string) {
    await this.expectElementToContainText('[data-testid="current-project-name"]', projectName);
    await this.waitForPageLoad();
  }

  // Quick actions
  async createNewPost() {
    await this.createPostButton.click();
    await this.page.waitForURL("/dashboard/posts/new");
  }

  async connectNewChannel() {
    await this.connectChannelButton.click();
    await this.page.waitForURL("/dashboard/channels/connect");
  }

  async scheduleNewPost() {
    await this.schedulePostButton.click();
    await this.page.waitForURL("/dashboard/posts/new?schedule=true");
  }

  // Dashboard data methods
  async getStatsData() {
    await this.expectElementToBeVisible('[data-testid="overview-stats"]');

    const stats = {
      totalPosts: await this.totalPostsCount.textContent(),
      scheduledPosts: await this.scheduledPostsCount.textContent(),
      publishedPosts: await this.publishedPostsCount.textContent(),
      connectedChannels: await this.connectedChannelsCount.textContent(),
    };

    return stats;
  }

  async getRecentActivityItems() {
    await this.expectElementToBeVisible('[data-testid="recent-activity"]');

    const items = await this.activityItems.all();
    const activityData = [];

    for (const item of items) {
      const text = await item.textContent();
      const timestamp = await item.locator('[data-testid="activity-timestamp"]').textContent();
      activityData.push({ text, timestamp });
    }

    return activityData;
  }

  async getUpcomingPosts() {
    await this.expectElementToBeVisible('[data-testid="upcoming-posts"]');

    const items = await this.upcomingPostItems.all();
    const upcomingData = [];

    for (const item of items) {
      const title = await item.locator('[data-testid="post-title"]').textContent();
      const scheduledTime = await item.locator('[data-testid="scheduled-time"]').textContent();
      const channels = await item.locator('[data-testid="post-channels"]').textContent();
      upcomingData.push({ title, scheduledTime, channels });
    }

    return upcomingData;
  }

  async getChannelStatuses() {
    await this.expectElementToBeVisible('[data-testid="channel-status"]');

    const items = await this.channelStatusItems.all();
    const statusData = [];

    for (const item of items) {
      const name = await item.locator('[data-testid="channel-name"]').textContent();
      const status = await item
        .locator('[data-testid="channel-status-indicator"]')
        .getAttribute("data-status");
      const platform = await item.locator('[data-testid="channel-platform"]').textContent();
      statusData.push({ name, status, platform });
    }

    return statusData;
  }

  // Analytics preview methods
  async viewFullAnalytics() {
    await this.viewFullAnalyticsButton.click();
    await this.page.waitForURL("/dashboard/analytics");
  }

  async waitForAnalyticsChartToLoad() {
    await this.expectElementToBeVisible('[data-testid="engagement-chart"]');
    // Wait for chart animation to complete
    await this.page.waitForTimeout(1000);
  }

  // Validation methods
  async expectDashboardToBeLoaded() {
    await this.expectElementToBeVisible('[data-testid="dashboard-header"]');
    await this.expectElementToBeVisible('[data-testid="sidebar-nav"]');
    await this.expectElementToBeVisible('[data-testid="overview-stats"]');
  }

  async expectProjectToBeSelected(projectName: string) {
    await this.expectElementToContainText('[data-testid="current-project-name"]', projectName);
  }

  async expectStatsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="total-posts-count"]');
    await this.expectElementToBeVisible('[data-testid="scheduled-posts-count"]');
    await this.expectElementToBeVisible('[data-testid="published-posts-count"]');
    await this.expectElementToBeVisible('[data-testid="connected-channels-count"]');
  }

  async expectRecentActivityToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="recent-activity"]');
  }

  async expectUpcomingPostsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="upcoming-posts"]');
  }

  async expectChannelStatusToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="channel-status"]');
  }

  async expectAnalyticsPreviewToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="analytics-preview"]');
  }

  // Mobile-specific methods
  async openMobileSidebar() {
    const mobileMenuButton = this.page.locator('[data-testid="mobile-menu-button"]');
    if (await mobileMenuButton.isVisible()) {
      await mobileMenuButton.click();
      await this.expectElementToBeVisible('[data-testid="mobile-sidebar"]');
    }
  }

  async closeMobileSidebar() {
    const mobileCloseButton = this.page.locator('[data-testid="mobile-sidebar-close"]');
    if (await mobileCloseButton.isVisible()) {
      await mobileCloseButton.click();
      await this.expectElementToBeHidden('[data-testid="mobile-sidebar"]');
    }
  }

  // Responsive layout checks
  async expectDesktopLayout() {
    await this.expectElementToBeVisible('[data-testid="sidebar-nav"]');
    await this.expectElementToBeHidden('[data-testid="mobile-menu-button"]');
  }

  async expectMobileLayout() {
    await this.expectElementToBeHidden('[data-testid="sidebar-nav"]');
    await this.expectElementToBeVisible('[data-testid="mobile-menu-button"]');
  }
}
