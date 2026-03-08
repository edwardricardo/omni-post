// Page type not used directly '@playwright/test';
// Page type not used directly './BasePage';

/**
 * Authentication Page Object Model
 * Handles login, registration, and password reset flows
 */

export class AuthPage extends BasePage {
  // Login form locators
  get emailInput(): Locator {
    return this.page.locator('[data-testid="email-input"]');
  }

  get passwordInput(): Locator {
    return this.page.locator('[data-testid="password-input"]');
  }

  get loginButton(): Locator {
    return this.page.locator('[data-testid="login-button"]');
  }

  get forgotPasswordLink(): Locator {
    return this.page.locator('[data-testid="forgot-password-link"]');
  }

  get signUpLink(): Locator {
    return this.page.locator('[data-testid="signup-link"]');
  }

  // Registration form locators
  get firstNameInput(): Locator {
    return this.page.locator('[data-testid="first-name-input"]');
  }

  get lastNameInput(): Locator {
    return this.page.locator('[data-testid="last-name-input"]');
  }

  get confirmPasswordInput(): Locator {
    return this.page.locator('[data-testid="confirm-password-input"]');
  }

  get signUpButton(): Locator {
    return this.page.locator('[data-testid="signup-button"]');
  }

  get termsCheckbox(): Locator {
    return this.page.locator('[data-testid="terms-checkbox"]');
  }

  get signInLink(): Locator {
    return this.page.locator('[data-testid="signin-link"]');
  }

  // Password reset form locators
  get resetEmailInput(): Locator {
    return this.page.locator('[data-testid="reset-email-input"]');
  }

  get resetPasswordButton(): Locator {
    return this.page.locator('[data-testid="reset-password-button"]');
  }

  get backToLoginLink(): Locator {
    return this.page.locator('[data-testid="back-to-login-link"]');
  }

  // New password form locators (from reset email)
  get newPasswordInput(): Locator {
    return this.page.locator('[data-testid="new-password-input"]');
  }

  get confirmNewPasswordInput(): Locator {
    return this.page.locator('[data-testid="confirm-new-password-input"]');
  }

  get updatePasswordButton(): Locator {
    return this.page.locator('[data-testid="update-password-button"]');
  }

  // MFA locators
  get mfaCodeInput(): Locator {
    return this.page.locator('[data-testid="mfa-code-input"]');
  }

  get verifyMfaButton(): Locator {
    return this.page.locator('[data-testid="verify-mfa-button"]');
  }

  get resendCodeButton(): Locator {
    return this.page.locator('[data-testid="resend-code-button"]');
  }

  // Social login locators
  get googleLoginButton(): Locator {
    return this.page.locator('[data-testid="google-login-button"]');
  }

  get githubLoginButton(): Locator {
    return this.page.locator('[data-testid="github-login-button"]');
  }

  // Navigation methods
  async goToLogin() {
    await this.goto("/login");
  }

  async goToSignUp() {
    await this.goto("/signup");
  }

  async goToForgotPassword() {
    await this.goto("/forgot-password");
  }

  // Login flow methods
  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async loginWithValidCredentials(email?: string, password?: string) {
    const defaultEmail = email || "e2e-test-user@example.com";
    const defaultPassword = password || "Test123!@#";

    await this.login(defaultEmail, defaultPassword);
    await this.waitForSuccessfulLogin();
  }

  async loginAsAdmin() {
    await this.login("e2e-admin-user@example.com", "Admin123!@#");
    await this.waitForSuccessfulLogin();
  }

  async waitForSuccessfulLogin() {
    await this.page.waitForURL("/dashboard");
    await this.expectElementToBeVisible('[data-testid="dashboard-header"]');
  }

  // Registration flow methods
  async signUp(userData: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    confirmPassword?: string;
  }) {
    await this.firstNameInput.fill(userData.firstName);
    await this.lastNameInput.fill(userData.lastName);
    await this.emailInput.fill(userData.email);
    await this.passwordInput.fill(userData.password);
    await this.confirmPasswordInput.fill(userData.confirmPassword || userData.password);

    // Accept terms and conditions
    await this.termsCheckbox.check();

    await this.signUpButton.click();
  }

  async signUpNewUser(
    overrides?: Partial<{
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }>
  ) {
    const _userData = {
      firstName: "Test",
      lastName: "User",
      email: `test-${Date.now()}@example.com`,
      password: "Test123!@#",
      ...overrides,
    };

    await this.signUp(userData);
    await this.waitForSuccessfulSignUp();
    return userData;
  }

  async waitForSuccessfulSignUp() {
    // Could redirect to email verification or dashboard
    await Promise.race([this.page.waitForURL("/verify-email"), this.page.waitForURL("/dashboard")]);
  }

  // Password reset flow methods
  async requestPasswordReset(email: string) {
    await this.resetEmailInput.fill(email);
    await this.resetPasswordButton.click();
  }

  async resetPassword(newPassword: string) {
    await this.newPasswordInput.fill(newPassword);
    await this.confirmNewPasswordInput.fill(newPassword);
    await this.updatePasswordButton.click();
  }

  async waitForPasswordResetConfirmation() {
    await this.expectSuccess("Password reset email sent");
  }

  async waitForPasswordUpdateSuccess() {
    await this.expectSuccess("Password updated successfully");
    await this.page.waitForURL("/login");
  }

  // MFA flow methods
  async enterMfaCode(code: string) {
    await this.mfaCodeInput.fill(code);
    await this.verifyMfaButton.click();
  }

  async resendMfaCode() {
    await this.resendCodeButton.click();
    await this.expectToast("Verification code resent");
  }

  // Social login methods
  async loginWithGoogle() {
    await this.googleLoginButton.click();
    // Handle OAuth popup if needed
    await this.handleOAuthFlow("google");
  }

  async loginWithGithub() {
    await this.githubLoginButton.click();
    // Handle OAuth popup if needed
    await this.handleOAuthFlow("github");
  }

  private async handleOAuthFlow(_provider: string) {
    // In a real implementation, you might need to handle OAuth popups
    // For E2E tests, you might want to mock the OAuth flow
    await this.page.waitForURL("/dashboard", { timeout: 10000 });
  }

  // Navigation between auth pages
  async goToSignUpFromLogin() {
    await this.signUpLink.click();
    await this.page.waitForURL("/signup");
  }

  async goToLoginFromSignUp() {
    await this.signInLink.click();
    await this.page.waitForURL("/login");
  }

  async goToForgotPasswordFromLogin() {
    await this.forgotPasswordLink.click();
    await this.page.waitForURL("/forgot-password");
  }

  async goToLoginFromForgotPassword() {
    await this.backToLoginLink.click();
    await this.page.waitForURL("/login");
  }

  // Validation helpers
  async expectLoginFormToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="email-input"]');
    await this.expectElementToBeVisible('[data-testid="password-input"]');
    await this.expectElementToBeVisible('[data-testid="login-button"]');
  }

  async expectSignUpFormToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="first-name-input"]');
    await this.expectElementToBeVisible('[data-testid="last-name-input"]');
    await this.expectElementToBeVisible('[data-testid="email-input"]');
    await this.expectElementToBeVisible('[data-testid="password-input"]');
    await this.expectElementToBeVisible('[data-testid="confirm-password-input"]');
    await this.expectElementToBeVisible('[data-testid="signup-button"]');
  }

  async expectPasswordResetFormToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="reset-email-input"]');
    await this.expectElementToBeVisible('[data-testid="reset-password-button"]');
  }

  async expectMfaFormToBeVisible() {
    await this.expectElementToBeVisible('[data-testid="mfa-code-input"]');
    await this.expectElementToBeVisible('[data-testid="verify-mfa-button"]');
  }

  // Error validation
  async expectInvalidCredentialsError() {
    await this.expectError("Invalid email or password");
  }

  async expectEmailRequiredError() {
    await this.expectError("Email is required");
  }

  async expectPasswordRequiredError() {
    await this.expectError("Password is required");
  }

  async expectPasswordMismatchError() {
    await this.expectError("Passwords do not match");
  }

  async expectWeakPasswordError() {
    await this.expectError("Password must be at least 8 characters");
  }

  async expectEmailAlreadyExistsError() {
    await this.expectError("An account with this email already exists");
  }

  async expectInvalidMfaCodeError() {
    await this.expectError("Invalid verification code");
  }
}
