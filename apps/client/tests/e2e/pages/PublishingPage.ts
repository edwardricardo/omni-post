/**
 * @file PublishingPage.ts
 * @description Tests for publishing page
 * @layer infrastructure
 */
// Page type not used directly '@playwright/test';
// Page type not used directly './BasePage';

/**
 * Publishing Page Object Model
 * Handles post creation, editing, scheduling, and publishing workflows
 */

export class PublishingPage extends BasePage {
  // Post creation form
  get postContentEditor(): Locator {
    return this.page.locator('[data-testid="post-content-editor"]');
  }

  get postContentTextarea(): Locator {
    return this.page.locator('[data-testid="post-content-textarea"]');
  }

  get characterCount(): Locator {
    return this.page.locator('[data-testid="character-count"]');
  }

  get characterLimit(): Locator {
    return this.page.locator('[data-testid="character-limit"]');
  }

  // Media upload
  get mediaUploadDropzone(): Locator {
    return this.page.locator('[data-testid="media-upload-dropzone"]');
  }

  get mediaUploadInput(): Locator {
    return this.page.locator('[data-testid="media-upload-input"]');
  }

  get uploadedMediaItems(): Locator {
    return this.page.locator('[data-testid="uploaded-media-item"]');
  }

  get removeMediaButton(): Locator {
    return this.page.locator('[data-testid="remove-media-button"]');
  }

  get mediaPreview(): Locator {
    return this.page.locator('[data-testid="media-preview"]');
  }

  // Channel selection
  get channelSelector(): Locator {
    return this.page.locator('[data-testid="channel-selector"]');
  }

  get channelOptions(): Locator {
    return this.page.locator('[data-testid="channel-option"]');
  }

  get selectedChannels(): Locator {
    return this.page.locator('[data-testid="selected-channel"]');
  }

  get selectAllChannelsButton(): Locator {
    return this.page.locator('[data-testid="select-all-channels"]');
  }

  get deselectAllChannelsButton(): Locator {
    return this.page.locator('[data-testid="deselect-all-channels"]');
  }

  // Platform-specific previews
  get platformPreviewTabs(): Locator {
    return this.page.locator('[data-testid="platform-preview-tabs"]');
  }

  get twitterPreview(): Locator {
    return this.page.locator('[data-testid="twitter-preview"]');
  }

  get instagramPreview(): Locator {
    return this.page.locator('[data-testid="instagram-preview"]');
  }

  get facebookPreview(): Locator {
    return this.page.locator('[data-testid="facebook-preview"]');
  }

  get linkedinPreview(): Locator {
    return this.page.locator('[data-testid="linkedin-preview"]');
  }

  get previewToggle(): Locator {
    return this.page.locator('[data-testid="preview-toggle"]');
  }

  // Scheduling
  get scheduleToggle(): Locator {
    return this.page.locator('[data-testid="schedule-toggle"]');
  }

  get scheduleDateInput(): Locator {
    return this.page.locator('[data-testid="schedule-date-input"]');
  }

  get scheduleTimeInput(): Locator {
    return this.page.locator('[data-testid="schedule-time-input"]');
  }

  get scheduleTimezoneSelect(): Locator {
    return this.page.locator('[data-testid="schedule-timezone-select"]');
  }

  get optimalTimeButton(): Locator {
    return this.page.locator('[data-testid="optimal-time-button"]');
  }

  get scheduledDateTime(): Locator {
    return this.page.locator('[data-testid="scheduled-datetime"]');
  }

  // Advanced options
  get advancedOptionsToggle(): Locator {
    return this.page.locator('[data-testid="advanced-options-toggle"]');
  }

  get postCategorySelect(): Locator {
    return this.page.locator('[data-testid="post-category-select"]');
  }

  get postTagsInput(): Locator {
    return this.page.locator('[data-testid="post-tags-input"]');
  }

  get autoHashtagsToggle(): Locator {
    return this.page.locator('[data-testid="auto-hashtags-toggle"]');
  }

  get crossPostingToggle(): Locator {
    return this.page.locator('[data-testid="cross-posting-toggle"]');
  }

  // Platform-specific settings
  get twitterThreadToggle(): Locator {
    return this.page.locator('[data-testid="twitter-thread-toggle"]');
  }

  get instagramStoryToggle(): Locator {
    return this.page.locator('[data-testid="instagram-story-toggle"]');
  }

  get facebookAudienceSelect(): Locator {
    return this.page.locator('[data-testid="facebook-audience-select"]');
  }

  get linkedinVisibilitySelect(): Locator {
    return this.page.locator('[data-testid="linkedin-visibility-select"]');
  }

  // Action buttons
  get saveDraftButton(): Locator {
    return this.page.locator('[data-testid="save-draft-button"]');
  }

  get publishNowButton(): Locator {
    return this.page.locator('[data-testid="publish-now-button"]');
  }

  get schedulePostButton(): Locator {
    return this.page.locator('[data-testid="schedule-post-button"]');
  }

  get previewPostButton(): Locator {
    return this.page.locator('[data-testid="preview-post-button"]');
  }

  get cancelButton(): Locator {
    return this.page.locator('[data-testid="cancel-button"]');
  }

  // Auto-save indicator
  get autoSaveIndicator(): Locator {
    return this.page.locator('[data-testid="auto-save-indicator"]');
  }

  get lastSavedTime(): Locator {
    return this.page.locator('[data-testid="last-saved-time"]');
  }

  // Validation messages
  get contentRequiredError(): Locator {
    return this.page.locator('[data-testid="content-required-error"]');
  }

  get channelRequiredError(): Locator {
    return this.page.locator('[data-testid="channel-required-error"]');
  }

  get scheduleTimeError(): Locator {
    return this.page.locator('[data-testid="schedule-time-error"]');
  }

  get characterLimitError(): Locator {
    return this.page.locator('[data-testid="character-limit-error"]');
  }

  // Navigation methods
  async goToCreatePost() {
    await this.goto("/dashboard/posts/new");
  }

  async goToEditPost(postId: string) {
    await this.goto(`/dashboard/posts/${postId}/edit`);
  }

  async goToPostPreview(postId: string) {
    await this.goto(`/dashboard/posts/${postId}/preview`);
  }

  // Content creation methods
  async enterPostContent(content: string) {
    await this.postContentTextarea.fill(content);
    await this.waitForAutoSave();
  }

  async appendToPostContent(additionalContent: string) {
    await this.postContentTextarea.focus();
    await this.postContentTextarea.press("End");
    await this.typeText(additionalContent);
    await this.waitForAutoSave();
  }

  async clearPostContent() {
    await this.postContentTextarea.fill("");
    await this.waitForAutoSave();
  }

  async waitForAutoSave() {
    await this.expectElementToContainText('[data-testid="auto-save-indicator"]', "Saved");
  }

  // Media upload methods
  async uploadMedia(filePath: string) {
    await this.mediaUploadInput.setInputFiles(filePath);
    await this.waitForMediaUpload();
  }

  async uploadMultipleMedia(filePaths: string[]) {
    await this.mediaUploadInput.setInputFiles(filePaths);
    await this.waitForMediaUpload();
  }

  async waitForMediaUpload() {
    await this.expectElementToBeVisible('[data-testid="uploaded-media-item"]');
    await this.waitForAutoSave();
  }

  async removeMediaItem(index: number = 0) {
    const mediaItems = await this.uploadedMediaItems.all();
    if (mediaItems[index]) {
      await mediaItems[index].locator('[data-testid="remove-media-button"]').click();
      await this.waitForAutoSave();
    }
  }

  async dragAndDropMedia(filePath: string) {
    // Simulate drag and drop file upload
    const buffer = await this.page.evaluate(async (path) => {
      const response = await fetch(path);
      return response.arrayBuffer();
    }, filePath);

    await this.mediaUploadDropzone.dispatchEvent("drop", {
      dataTransfer: {
        files: [new File([buffer], "test-image.jpg", { type: "image/jpeg" })],
      },
    });

    await this.waitForMediaUpload();
  }

  // Channel selection methods
  async selectChannel(channelId: string) {
    await this.page.locator(`[data-testid="channel-option-${channelId}"]`).click();
    await this.waitForAutoSave();
  }

  async selectChannelByPlatform(platform: string) {
    await this.page.locator(`[data-testid="channel-${platform}"]`).first().click();
    await this.waitForAutoSave();
  }

  async selectAllChannels() {
    await this.selectAllChannelsButton.click();
    await this.waitForAutoSave();
  }

  async deselectAllChannels() {
    await this.deselectAllChannelsButton.click();
    await this.waitForAutoSave();
  }

  async getSelectedChannelsCount(): Promise<number> {
    const channels = await this.selectedChannels.all();
    return channels.length;
  }

  // Preview methods
  async togglePreview() {
    await this.previewToggle.click();
  }

  async switchToPlatformPreview(platform: "twitter" | "instagram" | "facebook" | "linkedin") {
    await this.page.locator(`[data-testid="preview-tab-${platform}"]`).click();
    await this.expectElementToBeVisible(`[data-testid="${platform}-preview"]`);
  }

  async getCharacterCount(): Promise<string> {
    return (await this.characterCount.textContent()) || "0";
  }

  async getCharacterLimit(): Promise<string> {
    return (await this.characterLimit.textContent()) || "280";
  }

  // Scheduling methods
  async enableScheduling() {
    await this.scheduleToggle.click();
    await this.expectElementToBeVisible('[data-testid="schedule-date-input"]');
  }

  async disableScheduling() {
    await this.scheduleToggle.click();
    await this.expectElementToBeHidden('[data-testid="schedule-date-input"]');
  }

  async schedulePost(date: string, time: string, timezone?: string) {
    await this.enableScheduling();

    await this.scheduleDateInput.fill(date);
    await this.scheduleTimeInput.fill(time);

    if (timezone) {
      await this.scheduleTimezoneSelect.selectOption(timezone);
    }

    await this.waitForAutoSave();
  }

  async useOptimalTime() {
    await this.enableScheduling();
    await this.optimalTimeButton.click();
    await this.expectElementToBeVisible('[data-testid="scheduled-datetime"]');
  }

  async getScheduledDateTime(): Promise<string> {
    return (await this.scheduledDateTime.textContent()) || "";
  }

  // Advanced options methods
  async expandAdvancedOptions() {
    await this.advancedOptionsToggle.click();
    await this.expectElementToBeVisible('[data-testid="post-category-select"]');
  }

  async setPostCategory(category: string) {
    await this.expandAdvancedOptions();
    await this.postCategorySelect.selectOption(category);
    await this.waitForAutoSave();
  }

  async addPostTags(tags: string[]) {
    await this.expandAdvancedOptions();
    for (const tag of tags) {
      await this.postTagsInput.fill(tag);
      await this.pressKey("Enter");
    }
    await this.waitForAutoSave();
  }

  async enableAutoHashtags() {
    await this.expandAdvancedOptions();
    await this.autoHashtagsToggle.check();
    await this.waitForAutoSave();
  }

  async enableCrossPosting() {
    await this.expandAdvancedOptions();
    await this.crossPostingToggle.check();
    await this.waitForAutoSave();
  }

  // Platform-specific settings
  async enableTwitterThread() {
    await this.twitterThreadToggle.check();
    await this.waitForAutoSave();
  }

  async enableInstagramStory() {
    await this.instagramStoryToggle.check();
    await this.waitForAutoSave();
  }

  async setFacebookAudience(audience: string) {
    await this.facebookAudienceSelect.selectOption(audience);
    await this.waitForAutoSave();
  }

  async setLinkedInVisibility(visibility: string) {
    await this.linkedinVisibilitySelect.selectOption(visibility);
    await this.waitForAutoSave();
  }

  // Publishing actions
  async saveDraft() {
    await this.saveDraftButton.click();
    await this.expectToast("Draft saved successfully");
  }

  async publishNow() {
    await this.publishNowButton.click();
    await this.expectToast("Post published successfully");
  }

  async schedulePostForLater() {
    await this.schedulePostButton.click();
    await this.expectToast("Post scheduled successfully");
  }

  async previewPost() {
    await this.previewPostButton.click();
    await this.page.waitForURL(/\/preview$/);
  }

  async cancelPost() {
    await this.cancelButton.click();
    await this.page.waitForURL("/dashboard/posts");
  }

  // Validation methods
  async expectPostCreationFormToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="post-content-textarea"]');
    await this.expectElementToBeVisible('[data-testid="channel-selector"]');
    await this.expectElementToBeVisible('[data-testid="publish-now-button"]');
  }

  async expectContentRequiredError() {
    await this.expectElementToBeVisible('[data-testid="content-required-error"]');
  }

  async expectChannelRequiredError() {
    await this.expectElementToBeVisible('[data-testid="channel-required-error"]');
  }

  async expectCharacterLimitError() {
    await this.expectElementToBeVisible('[data-testid="character-limit-error"]');
  }

  async expectScheduleTimeError() {
    await this.expectElementToBeVisible('[data-testid="schedule-time-error"]');
  }

  async expectMediaUploadedSuccessfully() {
    await this.expectElementToBeVisible('[data-testid="uploaded-media-item"]');
    await this.expectElementToBeVisible('[data-testid="media-preview"]');
  }

  async expectPreviewToShowContent(content: string) {
    await this.togglePreview();
    await this.expectElementToContainText('[data-testid="twitter-preview"]', content);
  }

  async expectSchedulingOptionsToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="schedule-date-input"]');
    await this.expectElementToBeVisible('[data-testid="schedule-time-input"]');
    await this.expectElementToBeVisible('[data-testid="schedule-timezone-select"]');
  }

  // Content validation helpers
  async createBasicTextPost(content: string, channels?: string[]) {
    await this.enterPostContent(content);

    if (channels) {
      await this.deselectAllChannels();
      for (const channel of channels) {
        await this.selectChannelByPlatform(channel);
      }
    } else {
      await this.selectAllChannels();
    }

    return {
      content,
      channels: await this.getSelectedChannelsCount(),
      characterCount: await this.getCharacterCount(),
    };
  }

  async createScheduledPost(content: string, date: string, time: string) {
    await this.createBasicTextPost(content);
    await this.schedulePost(date, time);

    return {
      content,
      scheduledTime: await this.getScheduledDateTime(),
    };
  }

  async createPostWithMedia(content: string, mediaPath: string) {
    await this.enterPostContent(content);
    await this.uploadMedia(mediaPath);
    await this.selectAllChannels();

    const mediaItems = await this.uploadedMediaItems.count();

    return {
      content,
      mediaCount: mediaItems,
      characterCount: await this.getCharacterCount(),
    };
  }
}
