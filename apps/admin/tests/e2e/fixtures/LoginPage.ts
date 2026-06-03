/**
 * @file LoginPage.ts
 * @description Tests for login page
 * @layer infrastructure
 */
import { Page, Locator, expect } from "@playwright/test";

/**
 * Page Object Model for the Login page
 * Encapsulates all interactions with the login form
 */
export class LoginPage {
  readonly page: Page;

  // Locators for page elements
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;

    // Form elements - using semantic selectors where possible
    this.emailInput = page.locator('input[name="email"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.rememberMeCheckbox = page.locator('input[name="rememberMe"]');
    this.submitButton = page.locator('button[type="submit"]');

    // Feedback elements
    this.errorAlert = page.locator('[data-testid="login-error"]');
    this.heading = page.locator('h2:has-text("Admin Login")');
  }

  /**
   * Navigate to the login page
   */
  async goto(): Promise<void> {
    await this.page.goto("/auth/login");
    await this.heading.waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Fill in the email field
   */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  /**
   * Fill in the password field
   */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  /**
   * Toggle the "Remember me" checkbox
   * @param checked - true to check, false to uncheck
   */
  async toggleRememberMe(checked: boolean): Promise<void> {
    if (checked) {
      await this.rememberMeCheckbox.check();
    } else {
      await this.rememberMeCheckbox.uncheck();
    }
  }

  /**
   * Submit the login form
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * Get the error message text, if any
   * Returns null if no error is displayed
   */
  async getErrorMessage(): Promise<string | null> {
    try {
      await this.errorAlert.waitFor({ state: "visible", timeout: 2000 });
      return await this.errorAlert.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Check if error message is visible
   */
  async hasError(): Promise<boolean> {
    try {
      await this.errorAlert.waitFor({ state: "visible", timeout: 1000 });
      return await this.errorAlert.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Wait for error message to appear
   */
  async waitForError(timeout = 5000): Promise<string> {
    await this.errorAlert.waitFor({ state: "visible", timeout });
    const text = await this.errorAlert.textContent();
    return text || "";
  }

  /**
   * Check if the form is in loading state
   */
  async isLoading(): Promise<boolean> {
    const disabled = await this.submitButton.getAttribute("disabled");
    const ariaBusy = await this.submitButton.getAttribute("aria-busy");
    return disabled !== null || ariaBusy === "true";
  }

  /**
   * Wait for loading state to complete
   */
  async waitForLoadingComplete(timeout = 10000): Promise<void> {
    await this.page.waitForFunction(
      (selector) => {
        const button = document.querySelector(selector);
        if (!button) return true;
        return !button.hasAttribute("disabled") && button.getAttribute("aria-busy") !== "true";
      },
      'button[type="submit"]',
      { timeout }
    );
  }

  /**
   * Get the submit button text
   */
  async getSubmitButtonText(): Promise<string> {
    const text = await this.submitButton.textContent();
    return text?.trim() || "";
  }

  /**
   * Complete login flow with credentials
   * @param email - Email address
   * @param password - Password
   * @param rememberMe - Whether to check "Remember me"
   */
  async login(email: string, password: string, rememberMe = false): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);

    if (rememberMe) {
      await this.toggleRememberMe(true);
    }

    await this.submit();
  }

  /**
   * Verify page accessibility attributes
   */
  async verifyAccessibility(): Promise<void> {
    // Check ARIA labels
    await expect(this.emailInput).toHaveAttribute("aria-label", "Email address");
    await expect(this.passwordInput).toHaveAttribute("aria-label", "Password");
    await expect(this.rememberMeCheckbox).toHaveAttribute("aria-label", "Remember me");

    // Check required attributes
    await expect(this.emailInput).toHaveAttribute("aria-required", "true");
    await expect(this.passwordInput).toHaveAttribute("aria-required", "true");

    // Check input types
    await expect(this.emailInput).toHaveAttribute("type", "email");
    await expect(this.passwordInput).toHaveAttribute("type", "password");

    // Check autocomplete attributes
    await expect(this.emailInput).toHaveAttribute("autocomplete", "email");
    await expect(this.passwordInput).toHaveAttribute("autocomplete", "current-password");

    // Check error alert has proper ARIA — role="alert" implies
    // aria-live="assertive" + aria-atomic="true" per WAI-ARIA, so asserting
    // on role alone is the canonical check.
    if (await this.hasError()) {
      await expect(this.errorAlert).toHaveAttribute("role", "alert");
    }
  }

  /**
   * Verify form validation (client-side)
   */
  async verifyFormValidation(): Promise<void> {
    // Email should be required
    await expect(this.emailInput).toHaveAttribute("required", "");
    // Password should be required
    await expect(this.passwordInput).toHaveAttribute("required", "");
  }

  /**
   * Press Enter key to submit form
   */
  async pressEnter(): Promise<void> {
    await this.passwordInput.press("Enter");
  }

  /**
   * Check if inputs are disabled (during loading)
   */
  async areInputsDisabled(): Promise<boolean> {
    const emailDisabled = await this.emailInput.isDisabled();
    const passwordDisabled = await this.passwordInput.isDisabled();
    return emailDisabled && passwordDisabled;
  }

  /**
   * Get the current focus element
   */
  async getFocusedElement(): Promise<string> {
    return await this.page.evaluate(() => {
      const element = document.activeElement;
      return element?.getAttribute("name") || element?.tagName || "";
    });
  }

  /**
   * Verify page is rendered correctly
   */
  async verifyPageRender(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.rememberMeCheckbox).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }
}
