import { test, expect } from "../config/test-setup";
// Page type not used directly '../pages/AuthPage';
// Page type not used directly '../pages/DashboardPage';
// Page type not used directly '../pages/PublishingPage';
// Page type not used directly '../pages/AnalyticsPage';

/**
 * Visual Regression Tests
 * Captures and compares screenshots to detect unintended visual changes
 */

test.describe("Visual Regression Tests", () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let publishingPage: PublishingPage;
  let analyticsPage: AnalyticsPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    publishingPage = new PublishingPage(page);
    analyticsPage = new AnalyticsPage(page);
  });

  test.describe("Authentication Pages", () => {
    test("login page should match baseline", async ({ page }) => {
      await authPage.goToLogin();
      await authPage.expectLoginFormToBeVisible();

      // Wait for any animations to complete
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot("login-page.png");
    });

    test("registration page should match baseline", async ({ page }) => {
      await authPage.goToSignUp();
      await authPage.expectSignUpFormToBeVisible();

      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot("registration-page.png");
    });

    test("forgot password page should match baseline", async ({ page }) => {
      await authPage.goToForgotPassword();
      await authPage.expectPasswordResetFormToBeVisible();

      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot("forgot-password-page.png");
    });
  });

  test.describe("Dashboard Views", () => {
    test.beforeEach(async () => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.expectDashboardToBeLoaded();
    });

    test("dashboard overview should match baseline", async ({ page }) => {
      await dashboardPage.goToDashboard();
      await dashboardPage.expectDashboardToBeLoaded();

      // Wait for all widgets to load
      await dashboardPage.expectStatsToBeVisible();
      await dashboardPage.expectRecentActivityToBeVisible();

      // Mask dynamic content
      await page.locator('[data-testid="last-updated"]').evaluate((el) => {
        el.textContent = "Updated 5 minutes ago";
      });

      await page.locator('[data-testid="current-time"]').evaluate((el) => {
        el.textContent = "2:30 PM";
      });

      await expect(page).toHaveScreenshot("dashboard-overview.png");
    });

    test("empty dashboard state should match baseline", async ({ page, apiHelper }) => {
      // Mock empty data
      await apiHelper.mockApiResponse("/api/dashboard/stats", {
        totalPosts: 0,
        scheduledPosts: 0,
        publishedPosts: 0,
        connectedChannels: 0,
      });

      await apiHelper.mockApiResponse("/api/dashboard/recent-activity", {
        activities: [],
      });

      await dashboardPage.goToDashboard();

      await expect(page).toHaveScreenshot("dashboard-empty-state.png");
    });

    test("sidebar navigation should match baseline", async ({ page }) => {
      await dashboardPage.goToDashboard();

      // Focus on sidebar
      const sidebar = page.locator('[data-testid="sidebar-nav"]');
      await expect(sidebar).toHaveScreenshot("sidebar-navigation.png");
    });
  });

  test.describe("Post Creation Interface", () => {
    test.beforeEach(async () => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
    });

    test("new post form should match baseline", async ({ page }) => {
      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      // Wait for form to fully render
      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("post-creation-form.png");
    });

    test("post form with content should match baseline", async ({ page }) => {
      await publishingPage.goToCreatePost();
      await publishingPage.enterPostContent(
        "This is a sample post with content for visual testing #test"
      );
      await publishingPage.selectChannelByPlatform("twitter");

      // Wait for character count and other dynamic updates
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot("post-form-with-content.png");
    });

    test("platform preview should match baseline", async ({ page }) => {
      await publishingPage.goToCreatePost();
      await publishingPage.enterPostContent("Testing platform preview functionality");
      await publishingPage.selectChannelByPlatform("twitter");
      await publishingPage.togglePreview();

      await page.waitForTimeout(500);

      // Focus on preview area
      const preview = page.locator('[data-testid="platform-preview-tabs"]');
      await expect(preview).toHaveScreenshot("platform-preview.png");
    });

    test("scheduling interface should match baseline", async ({ page }) => {
      await publishingPage.goToCreatePost();
      await publishingPage.enableScheduling();

      await page.waitForTimeout(500);

      // Focus on scheduling section
      const scheduling = page.locator('[data-testid="scheduling-section"]');
      await expect(scheduling).toHaveScreenshot("scheduling-interface.png");
    });
  });

  test.describe("Analytics Dashboard", () => {
    test.beforeEach(async () => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
    });

    test("analytics overview should match baseline", async ({ page, apiHelper }) => {
      // Mock consistent analytics data
      await apiHelper.mockApiResponse("/api/analytics", {
        metrics: {
          totalPosts: 150,
          totalEngagement: 2850,
          totalReach: 45000,
          avgEngagementRate: 3.2,
        },
        chartData: [
          { date: "2024-01-01", engagement: 120, reach: 1800 },
          { date: "2024-01-02", engagement: 150, reach: 2200 },
          { date: "2024-01-03", engagement: 180, reach: 2500 },
        ],
      });

      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForAnalyticsToLoad();

      // Mask dynamic dates
      await page.locator('[data-testid="date-range-selector"]').evaluate((el) => {
        el.textContent = "Last 30 days";
      });

      await expect(page).toHaveScreenshot("analytics-overview.png");
    });

    test("metrics cards should match baseline", async ({ page, apiHelper }) => {
      await apiHelper.mockApiResponse("/api/analytics", {
        metrics: {
          totalPosts: 150,
          totalEngagement: 2850,
          totalReach: 45000,
          avgEngagementRate: 3.2,
          followerGrowth: 245,
          clickThroughRate: 1.8,
        },
      });

      await analyticsPage.goToAnalytics();
      await analyticsPage.waitForMetricsToLoad();

      // Focus on metrics section
      const metrics = page.locator('[data-testid="metrics-overview"]');
      await expect(metrics).toHaveScreenshot("analytics-metrics-cards.png");
    });

    test("empty analytics state should match baseline", async ({ page, apiHelper }) => {
      await apiHelper.mockApiResponse("/api/analytics", {
        metrics: {
          totalPosts: 0,
          totalEngagement: 0,
          totalReach: 0,
          avgEngagementRate: 0,
        },
        chartData: [],
        topPosts: [],
      });

      await analyticsPage.goToAnalytics();

      await expect(page).toHaveScreenshot("analytics-empty-state.png");
    });
  });

  test.describe("Responsive Design", () => {
    test.beforeEach(async () => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
    });

    test("mobile dashboard should match baseline", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await dashboardPage.goToDashboard();
      await dashboardPage.expectDashboardToBeLoaded();

      // Wait for mobile layout to stabilize
      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("mobile-dashboard.png");
    });

    test("tablet dashboard should match baseline", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await dashboardPage.goToDashboard();
      await dashboardPage.expectDashboardToBeLoaded();

      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("tablet-dashboard.png");
    });

    test("mobile post creation should match baseline", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("mobile-post-creation.png");
    });
  });

  test.describe("Component States", () => {
    test.beforeEach(async () => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
    });

    test("loading states should match baseline", async ({ page }) => {
      await dashboardPage.goToDashboard();

      // Trigger loading state
      await page.locator('[data-testid="refresh-button"]').click();

      // Capture loading spinner
      await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
      await expect(page.locator('[data-testid="loading-spinner"]')).toHaveScreenshot(
        "loading-spinner.png"
      );
    });

    test("error states should match baseline", async ({ page, apiHelper }) => {
      await apiHelper.mockApiResponse("/api/dashboard/stats", { error: "Server error" }, 500);

      await dashboardPage.goToDashboard();

      // Wait for error state
      await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toHaveScreenshot(
        "error-state.png"
      );
    });

    test("success toast should match baseline", async ({ page }) => {
      await publishingPage.goToCreatePost();
      await publishingPage.createBasicTextPost("Test post for visual testing");
      await publishingPage.saveDraft();

      // Capture toast notification
      await expect(page.locator('[data-testid="toast"]')).toBeVisible();
      await expect(page.locator('[data-testid="toast"]')).toHaveScreenshot("success-toast.png");
    });

    test("form validation errors should match baseline", async ({ page }) => {
      await authPage.goToLogin();

      // Trigger validation errors
      await authPage.loginButton.click();

      await expect(page.locator('[data-testid="email-required-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="login-form"]')).toHaveScreenshot(
        "form-validation-errors.png"
      );
    });
  });

  test.describe("Dark Mode", () => {
    test.beforeEach(async ({ page }) => {
      // Enable dark mode
      await page.emulateMedia({ colorScheme: "dark" });
    });

    test("dark mode dashboard should match baseline", async ({ page }) => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.goToDashboard();
      await dashboardPage.expectDashboardToBeLoaded();

      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("dark-mode-dashboard.png");
    });

    test("dark mode login should match baseline", async ({ page }) => {
      await authPage.goToLogin();
      await authPage.expectLoginFormToBeVisible();

      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot("dark-mode-login.png");
    });

    test("dark mode post creation should match baseline", async ({ page }) => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      await page.waitForTimeout(1000);

      await expect(page).toHaveScreenshot("dark-mode-post-creation.png");
    });
  });

  test.describe("Internationalization", () => {
    test.skip("should match baseline in different languages", async ({ page }) => {
      // This would test different language versions if i18n is implemented
      await page.addInitScript(() => {
        localStorage.setItem("language", "es");
      });

      await authPage.goToLogin();
      await authPage.expectLoginFormToBeVisible();

      await expect(page).toHaveScreenshot("login-spanish.png");
    });
  });

  test.describe("Animation States", () => {
    test("hover states should match baseline", async ({ page }) => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.goToDashboard();

      // Hover over navigation item
      await dashboardPage.postsNavLink.hover();
      await page.waitForTimeout(300); // Wait for hover animation

      const navItem = dashboardPage.postsNavLink;
      await expect(navItem).toHaveScreenshot("nav-item-hover.png");
    });

    test("focus states should match baseline", async ({ page }) => {
      await authPage.goToLogin();

      // Focus on email input
      await authPage.emailInput.focus();
      await page.waitForTimeout(200); // Wait for focus styles

      await expect(authPage.emailInput).toHaveScreenshot("input-focus-state.png");
    });
  });
});
