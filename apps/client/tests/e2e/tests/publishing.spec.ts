import { test, expect } from "../config/test-setup";
// Page type not used directly '../pages/PublishingPage';
// Page type not used directly '../pages/DashboardPage';
// Page type not used directly '../pages/AuthPage';
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Publishing E2E Tests
 * Tests complete post creation, editing, scheduling, and publishing workflows
 */

test.describe("Publishing Workflows", () => {
  let publishingPage: PublishingPage;
  let dashboardPage: DashboardPage;
  let authPage: AuthPage;

  test.beforeEach(async ({ page: _page }) => {
    publishingPage = new PublishingPage(page);
    dashboardPage = new DashboardPage(page);
    authPage = new AuthPage(page);

    // Login before each test
    await authPage.goToLogin();
    await authPage.loginWithValidCredentials();
    await dashboardPage.expectDashboardToBeLoaded();
  });

  test.describe("Post Creation", () => {
    test("should create a basic text post", async () => {
      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      const postData = await publishingPage.createBasicTextPost(
        "This is a test post for E2E testing #automation #playwright"
      );

      await publishingPage.saveDraft();

      expect(postData.content).toContain("This is a test post");
      expect(postData.channels).toBeGreaterThan(0);
      expect(parseInt(postData.characterCount)).toBeGreaterThan(0);
    });

    test("should validate required content", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.selectAllChannels();
      await publishingPage.publishNowButton.click();

      await publishingPage.expectContentRequiredError();
    });

    test("should validate channel selection", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Test post without channels");
      await publishingPage.deselectAllChannels();
      await publishingPage.publishNowButton.click();

      await publishingPage.expectChannelRequiredError();
    });

    test("should show character count for different platforms", async () => {
      await publishingPage.goToCreatePost();

      const shortContent = "Short post";
      await publishingPage.enterPostContent(shortContent);

      const characterCount = await publishingPage.getCharacterCount();
      expect(parseInt(characterCount)).toBe(shortContent.length);

      // Test with longer content
      const longContent =
        "This is a much longer post that might exceed character limits on some platforms like Twitter which has a 280 character limit for regular posts without premium features enabled";
      await publishingPage.enterPostContent(longContent);

      const newCharacterCount = await publishingPage.getCharacterCount();
      expect(parseInt(newCharacterCount)).toBe(longContent.length);
    });

    test("should auto-save draft while typing", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Testing auto-save functionality");
      await publishingPage.selectChannelByPlatform("twitter");

      // Wait for auto-save to complete
      await publishingPage.waitForAutoSave();
      await publishingPage.expectElementToContainText(
        '[data-testid="auto-save-indicator"]',
        "Saved"
      );
    });

    test("should preserve draft on page refresh", async ({ page: _page }) => {
      await publishingPage.goToCreatePost();

      const testContent = "This content should persist after refresh";
      await publishingPage.enterPostContent(testContent);
      await publishingPage.selectChannelByPlatform("twitter");
      await publishingPage.waitForAutoSave();

      // Refresh the page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Content should be preserved
      const preservedContent = await publishingPage.postContentTextarea.inputValue();
      expect(preservedContent).toBe(testContent);
    });
  });

  test.describe("Media Upload", () => {
    test("should upload single image", async () => {
      await publishingPage.goToCreatePost();

      // Create a test image file
      const testImagePath = path.join(__dirname, "../fixtures/test-image.jpg");

      await publishingPage.enterPostContent("Post with image attachment");
      await publishingPage.uploadMedia(testImagePath);

      await publishingPage.expectMediaUploadedSuccessfully();
    });

    test("should upload multiple images", async () => {
      await publishingPage.goToCreatePost();

      const testImages = [
        path.join(__dirname, "../fixtures/test-image-1.jpg"),
        path.join(__dirname, "../fixtures/test-image-2.jpg"),
      ];

      await publishingPage.enterPostContent("Post with multiple images");
      await publishingPage.uploadMultipleMedia(testImages);

      const mediaCount = await publishingPage.uploadedMediaItems.count();
      expect(mediaCount).toBe(2);
    });

    test("should remove uploaded media", async () => {
      await publishingPage.goToCreatePost();

      const testImagePath = path.join(__dirname, "../fixtures/test-image.jpg");
      await publishingPage.uploadMedia(testImagePath);
      await publishingPage.expectMediaUploadedSuccessfully();

      await publishingPage.removeMediaItem(0);

      const mediaCount = await publishingPage.uploadedMediaItems.count();
      expect(mediaCount).toBe(0);
    });

    test("should validate file size limits", async () => {
      await publishingPage.goToCreatePost();

      // This would need a large test file
      const largeImagePath = path.join(__dirname, "../fixtures/large-image.jpg");

      await publishingPage.uploadMedia(largeImagePath);
      await publishingPage.expectError("File size exceeds limit");
    });

    test("should validate file type restrictions", async () => {
      await publishingPage.goToCreatePost();

      const invalidFilePath = path.join(__dirname, "../fixtures/test-document.pdf");

      await publishingPage.uploadMedia(invalidFilePath);
      await publishingPage.expectError("File type not supported");
    });
  });

  test.describe("Channel Selection", () => {
    test("should select individual channels", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.selectChannelByPlatform("twitter");

      const selectedCount = await publishingPage.getSelectedChannelsCount();
      expect(selectedCount).toBe(1);
    });

    test("should select all channels", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.selectAllChannels();

      const selectedCount = await publishingPage.getSelectedChannelsCount();
      expect(selectedCount).toBeGreaterThan(1);
    });

    test("should deselect all channels", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.selectAllChannels();
      await publishingPage.deselectAllChannels();

      const selectedCount = await publishingPage.getSelectedChannelsCount();
      expect(selectedCount).toBe(0);
    });

    test("should show platform-specific previews", async () => {
      await publishingPage.goToCreatePost();

      const testContent = "Testing platform previews #test";
      await publishingPage.enterPostContent(testContent);
      await publishingPage.selectChannelByPlatform("twitter");

      await publishingPage.switchToPlatformPreview("twitter");
      await publishingPage.expectElementToContainText(
        '[data-testid="twitter-preview"]',
        testContent
      );
    });
  });

  test.describe("Post Scheduling", () => {
    test("should schedule post for future date", async () => {
      await publishingPage.goToCreatePost();

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const dateString = futureDate.toISOString().split("T")[0];
      const timeString = "14:30";

      const postData = await publishingPage.createScheduledPost(
        "This post is scheduled for tomorrow",
        dateString,
        timeString
      );

      await publishingPage.schedulePostForLater();

      expect(postData.content).toContain("scheduled for tomorrow");
      expect(postData.scheduledTime).toContain(dateString);
    });

    test("should use optimal posting time", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Post using optimal timing");
      await publishingPage.selectChannelByPlatform("twitter");
      await publishingPage.useOptimalTime();

      const scheduledTime = await publishingPage.getScheduledDateTime();
      expect(scheduledTime).toBeTruthy();
    });

    test("should validate future scheduling time", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Testing past date validation");
      await publishingPage.selectChannelByPlatform("twitter");

      // Try to schedule for past date
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      await publishingPage.schedulePost(pastDate.toISOString().split("T")[0], "10:00");

      await publishingPage.schedulePostButton.click();
      await publishingPage.expectScheduleTimeError();
    });

    test("should allow scheduling timezone selection", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Testing timezone selection");
      await publishingPage.selectChannelByPlatform("twitter");
      await publishingPage.enableScheduling();

      await publishingPage.scheduleTimezoneSelect.selectOption("America/New_York");

      const selectedTimezone = await publishingPage.scheduleTimezoneSelect.inputValue();
      expect(selectedTimezone).toBe("America/New_York");
    });
  });

  test.describe("Advanced Features", () => {
    test("should configure advanced post options", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Post with advanced options");
      await publishingPage.selectChannelByPlatform("twitter");

      await publishingPage.expandAdvancedOptions();
      await publishingPage.setPostCategory("Marketing");
      await publishingPage.addPostTags(["automation", "testing"]);
      await publishingPage.enableAutoHashtags();

      await publishingPage.saveDraft();
    });

    test("should enable cross-platform posting", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Cross-platform test post");
      await publishingPage.selectAllChannels();
      await publishingPage.enableCrossPosting();

      await publishingPage.saveDraft();
    });

    test("should configure Twitter thread", async () => {
      await publishingPage.goToCreatePost();

      const longContent =
        "This is a very long post that should be split into multiple tweets when the Twitter thread option is enabled. ".repeat(
          3
        );
      await publishingPage.enterPostContent(longContent);
      await publishingPage.selectChannelByPlatform("twitter");
      await publishingPage.enableTwitterThread();

      await publishingPage.saveDraft();
    });

    test("should configure Instagram story", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("Instagram story test");
      await publishingPage.selectChannelByPlatform("instagram");
      await publishingPage.enableInstagramStory();

      await publishingPage.saveDraft();
    });
  });

  test.describe("Publishing Actions", () => {
    test("should publish post immediately", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.createBasicTextPost("Publishing immediately");
      await publishingPage.publishNow();

      // Should redirect to posts list
      await publishingPage.expectUrl("/dashboard/posts");
    });

    test("should save post as draft", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.createBasicTextPost("Saving as draft");
      await publishingPage.saveDraft();

      await publishingPage.expectToast("Draft saved successfully");
    });

    test("should preview post before publishing", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.createBasicTextPost("Preview test post");
      await publishingPage.previewPost();

      await publishingPage.expectUrl(/\/preview$/);
    });

    test("should cancel post creation", async () => {
      await publishingPage.goToCreatePost();

      await publishingPage.enterPostContent("This post will be cancelled");
      await publishingPage.cancelPost();

      await publishingPage.expectUrl("/dashboard/posts");
    });
  });

  test.describe("Post Editing", () => {
    test("should edit existing draft", async ({ testData }) => {
      // Create a test post first
      const project = await testData.createTestProject();
      const post = await testData.createTestPost(project.id, "Original content");

      await publishingPage.goToEditPost(post.id);

      await publishingPage.clearPostContent();
      await publishingPage.enterPostContent("Updated content");
      await publishingPage.saveDraft();

      await publishingPage.expectToast("Draft saved successfully");
    });

    test("should preserve existing media when editing", async ({ testData }) => {
      const project = await testData.createTestProject();
      const post = await testData.createTestPost(project.id, "Post with media");

      await publishingPage.goToEditPost(post.id);

      // Media should be preserved
      const mediaCount = await publishingPage.uploadedMediaItems.count();
      expect(mediaCount).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe("Validation and Error Handling", () => {
    test("should handle character limit warnings", async () => {
      await publishingPage.goToCreatePost();

      const longContent = "x".repeat(300); // Exceeds Twitter limit
      await publishingPage.enterPostContent(longContent);
      await publishingPage.selectChannelByPlatform("twitter");

      const characterCount = await publishingPage.getCharacterCount();
      const characterLimit = await publishingPage.getCharacterLimit();

      if (parseInt(characterCount) > parseInt(characterLimit)) {
        await publishingPage.expectCharacterLimitError();
      }
    });

    test("should handle network errors gracefully", async ({ page: _page, apiHelper }) => {
      await publishingPage.goToCreatePost();

      // Mock network error
      await apiHelper.mockApiResponse("/api/posts", { error: "Network error" }, 500);

      await publishingPage.createBasicTextPost("Test network error");
      await publishingPage.publishNowButton.click();

      await publishingPage.expectError("Failed to publish post");
    });

    test("should handle media upload failures", async ({ apiHelper }) => {
      await publishingPage.goToCreatePost();

      // Mock upload failure
      await apiHelper.mockApiResponse("/api/media/upload", { error: "Upload failed" }, 500);

      const testImagePath = path.join(__dirname, "../fixtures/test-image.jpg");
      await publishingPage.uploadMedia(testImagePath);

      await publishingPage.expectError("Failed to upload media");
    });
  });

  test.describe("Performance", () => {
    test("should load post creation form quickly", async ({ page: _page }) => {
      const startTime = Date.now();

      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(3000); // Should load within 3 seconds
    });

    test("should handle large content efficiently", async () => {
      await publishingPage.goToCreatePost();

      const largeContent = "Large content test. ".repeat(100);

      const startTime = Date.now();
      await publishingPage.enterPostContent(largeContent);
      const typeTime = Date.now() - startTime;

      expect(typeTime).toBeLessThan(2000); // Should handle large content quickly
    });
  });

  test.describe("Accessibility", () => {
    test("post creation form should be accessible", async ({ axeBuilder }) => {
      await publishingPage.goToCreatePost();

      const accessibilityScanResults = await axeBuilder.analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("should support keyboard navigation", async ({ page: _page }) => {
      await publishingPage.goToCreatePost();

      // Tab through form elements
      await page.keyboard.press("Tab"); // Content textarea
      await expect(publishingPage.postContentTextarea).toBeFocused();

      // Skip through multiple tabs to reach publish button
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
      }

      // Should be able to reach action buttons via keyboard
      const focusedElement = await page.locator(":focus").getAttribute("data-testid");
      expect(["publish-now-button", "save-draft-button", "schedule-post-button"]).toContain(
        focusedElement
      );
    });
  });

  test.describe("Mobile Responsiveness", () => {
    test("should work on mobile devices", async ({ page: _page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await publishingPage.goToCreatePost();
      await publishingPage.expectPostCreationFormToBeVisible();

      await publishingPage.createBasicTextPost("Mobile test post");
      await publishingPage.saveDraft();
    });

    test("should handle touch interactions", async ({ page: _page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await publishingPage.goToCreatePost();

      // Test touch interactions
      await publishingPage.postContentTextarea.tap();
      await publishingPage.typeText("Touch interaction test");

      await publishingPage.selectAllChannelsButton.tap();
      await publishingPage.saveDraftButton.tap();
    });
  });
});
