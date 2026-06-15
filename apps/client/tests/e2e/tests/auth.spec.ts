/**
 * @file auth.spec.ts
 * @description Tests for Authentication Flows
 * @layer infrastructure
 */
import { test, expect } from "../config/test-setup";
// Page type not used directly '../pages/AuthPage';
// Page type not used directly '../pages/DashboardPage';

/**
 * Authentication E2E Tests
 * Tests complete authentication flows including login, registration, and password reset
 */

test.describe("Authentication Flows", () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page: _page }) => {
    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
  });

  test.describe("Login Flow", () => {
    test("should successfully login with valid credentials", async () => {
      await authPage.goToLogin();
      await authPage.expectLoginFormToBeVisible();

      await authPage.loginWithValidCredentials();
      await authPage.waitForSuccessfulLogin();

      await dashboardPage.expectDashboardToBeLoaded();
    });

    test("should show error for invalid credentials", async () => {
      await authPage.goToLogin();

      await authPage.login("invalid@example.com", "wrongpassword");
      await authPage.expectInvalidCredentialsError();
    });

    test("should show error for missing email", async () => {
      await authPage.goToLogin();

      await authPage.login("", "password123");
      await authPage.expectEmailRequiredError();
    });

    test("should show error for missing password", async () => {
      await authPage.goToLogin();

      await authPage.login("test@example.com", "");
      await authPage.expectPasswordRequiredError();
    });

    test("should navigate to sign up page from login", async () => {
      await authPage.goToLogin();

      await authPage.goToSignUpFromLogin();
      await authPage.expectSignUpFormToBeVisible();
    });

    test("should navigate to forgot password from login", async () => {
      await authPage.goToLogin();

      await authPage.goToForgotPasswordFromLogin();
      await authPage.expectPasswordResetFormToBeVisible();
    });

    test("should remember login state after page refresh", async ({ page: _page }) => {
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.expectDashboardToBeLoaded();

      // Refresh the page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Should still be logged in
      await dashboardPage.expectDashboardToBeLoaded();
    });
  });

  test.describe("Registration Flow", () => {
    test("should successfully register new user", async () => {
      await authPage.goToSignUp();
      await authPage.expectSignUpFormToBeVisible();

      const _userData = await authPage.signUpNewUser();
      await authPage.waitForSuccessfulSignUp();

      // Should either be in dashboard or email verification
      const currentUrl = authPage.page.url();
      expect(currentUrl).toMatch(/(dashboard|verify-email)/);
    });

    test("should show error for mismatched passwords", async () => {
      await authPage.goToSignUp();

      await authPage.signUp({
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        password: "password123",
        confirmPassword: "differentpassword",
      });

      await authPage.expectPasswordMismatchError();
    });

    test("should show error for weak password", async () => {
      await authPage.goToSignUp();

      await authPage.signUp({
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        password: "123",
      });

      await authPage.expectWeakPasswordError();
    });

    test("should show error for existing email", async () => {
      await authPage.goToSignUp();

      // Try to register with email that already exists
      await authPage.signUp({
        firstName: "Test",
        lastName: "User",
        email: "e2e-test-user@example.com", // Existing test user
        password: "Password123!",
      });

      await authPage.expectEmailAlreadyExistsError();
    });

    test("should navigate to login page from sign up", async () => {
      await authPage.goToSignUp();

      await authPage.goToLoginFromSignUp();
      await authPage.expectLoginFormToBeVisible();
    });

    test("should require terms acceptance", async ({ page: _page }) => {
      await authPage.goToSignUp();

      // Fill form but don't accept terms
      await authPage.firstNameInput.fill("Test");
      await authPage.lastNameInput.fill("User");
      await authPage.emailInput.fill("test@example.com");
      await authPage.passwordInput.fill("Password123!");
      await authPage.confirmPasswordInput.fill("Password123!");

      // Try to submit without accepting terms
      await authPage.signUpButton.click();

      // Should show terms required error
      await expect(page.locator('[data-testid="terms-required-error"]')).toBeVisible();
    });
  });

  test.describe("Password Reset Flow", () => {
    test("should send password reset email", async () => {
      await authPage.goToForgotPassword();
      await authPage.expectPasswordResetFormToBeVisible();

      await authPage.requestPasswordReset("e2e-test-user@example.com");
      await authPage.waitForPasswordResetConfirmation();
    });

    test("should show error for non-existent email", async () => {
      await authPage.goToForgotPassword();

      await authPage.requestPasswordReset("nonexistent@example.com");
      await authPage.expectError("No account found with this email address");
    });

    test("should navigate back to login from forgot password", async () => {
      await authPage.goToForgotPassword();

      await authPage.goToLoginFromForgotPassword();
      await authPage.expectLoginFormToBeVisible();
    });

    test("should reset password with valid token", async ({ page: _page }) => {
      // This test would typically require a valid reset token
      // In a real implementation, you might need to intercept emails or use API
      const resetToken = "valid-reset-token-for-testing";

      await authPage.goto(`/reset-password?token=${resetToken}`);
      await authPage.expectElementToBeVisible('[data-testid="new-password-input"]');

      await authPage.resetPassword("NewPassword123!");
      await authPage.waitForPasswordUpdateSuccess();
    });
  });

  test.describe("Logout Flow", () => {
    test("should successfully logout user", async () => {
      // Login first
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.expectDashboardToBeLoaded();

      // Logout
      await dashboardPage.logout();
      await authPage.expectLoginFormToBeVisible();
    });

    test("should clear session data on logout", async ({ page: _page }) => {
      // Login and verify session
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.expectDashboardToBeLoaded();

      // Logout
      await dashboardPage.logout();

      // Try to access protected page
      await page.goto("/dashboard");
      await page.waitForURL("/login");
      await authPage.expectLoginFormToBeVisible();
    });
  });

  test.describe("MFA Flow", () => {
    test.skip("should handle MFA verification", async () => {
      // This test would require MFA to be enabled for the test user
      await authPage.goToLogin();
      await authPage.login("mfa-user@example.com", "Password123!");

      await authPage.expectMfaFormToBeVisible();

      // In a real test, you'd need to get the MFA code
      const mfaCode = "123456";
      await authPage.enterMfaCode(mfaCode);

      await authPage.waitForSuccessfulLogin();
      await dashboardPage.expectDashboardToBeLoaded();
    });

    test.skip("should show error for invalid MFA code", async () => {
      await authPage.goToLogin();
      await authPage.login("mfa-user@example.com", "Password123!");
      await authPage.expectMfaFormToBeVisible();

      await authPage.enterMfaCode("000000");
      await authPage.expectInvalidMfaCodeError();
    });

    test.skip("should allow MFA code resend", async () => {
      await authPage.goToLogin();
      await authPage.login("mfa-user@example.com", "Password123!");
      await authPage.expectMfaFormToBeVisible();

      await authPage.resendMfaCode();
      await authPage.expectToast("Verification code resent");
    });
  });

  test.describe("Social Login", () => {
    test.skip("should login with Google", async () => {
      await authPage.goToLogin();

      await authPage.loginWithGoogle();
      await dashboardPage.expectDashboardToBeLoaded();
    });

    test.skip("should login with GitHub", async () => {
      await authPage.goToLogin();

      await authPage.loginWithGithub();
      await dashboardPage.expectDashboardToBeLoaded();
    });
  });

  test.describe("Session Management", () => {
    test("should handle expired session", async ({ page: _page }) => {
      // Login first
      await authPage.goToLogin();
      await authPage.loginWithValidCredentials();
      await dashboardPage.expectDashboardToBeLoaded();

      // Simulate expired session by clearing auth token
      await page.evaluate(() => {
        localStorage.removeItem("auth-token");
        sessionStorage.removeItem("auth-token");
      });

      // Try to access protected resource
      await page.goto("/dashboard/posts");
      await page.waitForURL("/login");
      await authPage.expectLoginFormToBeVisible();
    });

    test("should maintain session across tabs", async ({ context }) => {
      // Login in first tab
      const page1 = await context.newPage();
      const authPage1 = new AuthPage(page1);
      const dashboardPage1 = new DashboardPage(page1);

      await authPage1.goToLogin();
      await authPage1.loginWithValidCredentials();
      await dashboardPage1.expectDashboardToBeLoaded();

      // Open second tab
      const page2 = await context.newPage();
      const dashboardPage2 = new DashboardPage(page2);

      await dashboardPage2.goToDashboard();
      await dashboardPage2.expectDashboardToBeLoaded();

      // Should be logged in on both tabs
      await page1.close();
      await page2.close();
    });
  });

  test.describe("Form Validation", () => {
    test("should validate email format on login", async ({ page: _page }) => {
      await authPage.goToLogin();

      await authPage.emailInput.fill("invalid-email");
      await authPage.passwordInput.fill("password");
      await authPage.loginButton.click();

      await expect(page.locator('[data-testid="email-format-error"]')).toBeVisible();
    });

    test("should validate email format on registration", async ({ page: _page }) => {
      await authPage.goToSignUp();

      await authPage.emailInput.fill("invalid-email");
      await authPage.passwordInput.fill("password");
      await authPage.signUpButton.click();

      await expect(page.locator('[data-testid="email-format-error"]')).toBeVisible();
    });

    test("should validate required fields on registration", async ({ page: _page }) => {
      await authPage.goToSignUp();

      // Submit empty form
      await authPage.signUpButton.click();

      // All required field errors should be visible
      await expect(page.locator('[data-testid="first-name-required"]')).toBeVisible();
      await expect(page.locator('[data-testid="last-name-required"]')).toBeVisible();
      await expect(page.locator('[data-testid="email-required"]')).toBeVisible();
      await expect(page.locator('[data-testid="password-required"]')).toBeVisible();
    });
  });

  test.describe("Accessibility", () => {
    test("login page should be accessible", async ({ page: _page, axeBuilder }) => {
      await authPage.goToLogin();

      const accessibilityScanResults = await axeBuilder.analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("registration page should be accessible", async ({ page: _page, axeBuilder }) => {
      await authPage.goToSignUp();

      const accessibilityScanResults = await axeBuilder.analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("should support keyboard navigation on login form", async ({ page: _page }) => {
      await authPage.goToLogin();

      // Tab through form elements
      await page.keyboard.press("Tab"); // Email input
      await expect(authPage.emailInput).toBeFocused();

      await page.keyboard.press("Tab"); // Password input
      await expect(authPage.passwordInput).toBeFocused();

      await page.keyboard.press("Tab"); // Login button
      await expect(authPage.loginButton).toBeFocused();

      // Submit with Enter
      await authPage.emailInput.fill("e2e-test-user@example.com");
      await authPage.passwordInput.fill("Test123!@#");
      await page.keyboard.press("Enter");

      await authPage.waitForSuccessfulLogin();
    });
  });
});
