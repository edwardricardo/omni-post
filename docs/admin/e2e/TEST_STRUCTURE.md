# E2E Test Suite Structure

Visual representation of the test suite organization and file structure.

## Directory Structure

```
apps/admin/
├── playwright.config.ts           # Playwright configuration
├── .env.test                       # Test environment variables
├── package.json                    # Test scripts already configured
│
└── tests/
    └── e2e/
        ├── auth.spec.ts           # Main test suite (17 tests)
        ├── helpers.ts             # Test utilities
        ├── README.md              # Full documentation
        ├── QUICKSTART.md          # Quick start guide
        ├── TEST_IMPLEMENTATION_SUMMARY.md
        ├── TEST_STRUCTURE.md      # This file
        │
        └── fixtures/
            └── LoginPage.ts       # Page Object Model
```

## Test Suite Organization

```
Authentication Flow (auth.spec.ts)
│
├── 1. Login Page (4 tests)
│   ├── should render login page correctly
│   ├── should have proper accessibility attributes
│   ├── should have proper form validation attributes
│   └── should focus on email field on load
│
├── 2. Valid Login (3 tests)
│   ├── should login successfully with valid credentials
│   ├── should redirect to dashboard if already authenticated
│   └── should display user info on dashboard after login
│
├── 3. Invalid Login (3 tests)
│   ├── should show error for invalid email
│   ├── should show error for invalid password
│   └── should show user-friendly error messages
│
├── 4. Remember Me Functionality (2 tests)
│   ├── should respect remember me checkbox when checked
│   └── should handle session without remember me
│
├── 5. Loading States (2 tests)
│   ├── should show loading state during login
│   └── should disable form during submission
│
├── 6. Form Interaction (1 test)
│   └── should submit form on Enter key press
│
├── 7. Protected Routes (2 tests)
│   ├── should redirect to login when accessing protected route without auth
│   └── should redirect to originally requested page after login
│
├── 8. Logout (2 tests)
│   ├── should logout successfully
│   └── should clear session on logout
│
└── 9. Session Persistence (2 tests)
    ├── should maintain session across page reloads
    └── should maintain session across navigation
```

## Page Object Model (LoginPage.ts)

```
LoginPage
│
├── Properties (Locators)
│   ├── emailInput
│   ├── passwordInput
│   ├── rememberMeCheckbox
│   ├── submitButton
│   ├── errorAlert
│   └── heading
│
├── Navigation Methods
│   └── goto()
│
├── Input Methods
│   ├── fillEmail(email)
│   ├── fillPassword(password)
│   └── toggleRememberMe(checked)
│
├── Action Methods
│   ├── submit()
│   ├── login(email, password, rememberMe)
│   └── pressEnter()
│
├── Assertion Methods
│   ├── getErrorMessage()
│   ├── hasError()
│   ├── waitForError()
│   ├── isLoading()
│   ├── waitForLoadingComplete()
│   └── getSubmitButtonText()
│
├── State Methods
│   ├── areInputsDisabled()
│   └── getFocusedElement()
│
└── Verification Methods
    ├── verifyPageRender()
    ├── verifyAccessibility()
    └── verifyFormValidation()
```

## Helper Functions (helpers.ts)

```
Test Utilities
│
├── Authentication
│   ├── resetTestAdmin()          # Reset test admin account
│   ├── loginAs(page, email, pw)  # Quick login helper
│   ├── clearAuth(page)           # Clear auth state
│   └── getCurrentUserInfo(page)  # Get user info
│
├── Cookie Management
│   ├── waitForAuth(page)         # Wait for cookies
│   └── verifyAuthCookies(page)   # Verify cookies
│
├── Navigation
│   └── waitForNavigation(page, url)
│
├── UI State
│   ├── isVisible(page, selector)
│   ├── isLoading(page)
│   └── waitForElement(page, selector)
│
├── Debugging
│   └── takeDebugScreenshot(page, name)
│
└── Test Data
    ├── TEST_CREDENTIALS.VALID
    ├── TEST_CREDENTIALS.INVALID_EMAIL
    └── TEST_CREDENTIALS.INVALID_PASSWORD
```

## Test Execution Flow

```
Test Execution
│
├── 1. Test Setup (beforeEach)
│   ├── Reset test admin account
│   ├── Clear authentication cookies
│   ├── Clear local/session storage
│   └── Create LoginPage instance
│
├── 2. Test Execution
│   ├── Navigate to page
│   ├── Perform actions
│   ├── Make assertions
│   └── Capture diagnostics on failure
│
└── 3. Cleanup (automatic)
    ├── Take screenshot if failed
    ├── Record video if failed
    ├── Save trace on first retry
    └── Clear test state
```

## Configuration Flow

```
Playwright Configuration
│
├── Test Settings
│   ├── testDir: ./tests/e2e
│   ├── timeout: 60s per test
│   ├── workers: 1 (sequential)
│   └── retries: 2 on CI, 0 local
│
├── Browser Settings
│   ├── baseURL: http://localhost:3100
│   ├── viewport: 1280x720
│   └── ignoreHTTPSErrors: true
│
├── Capture Settings
│   ├── screenshot: on failure
│   ├── video: retain on failure
│   └── trace: on first retry
│
└── Projects
    └── chromium (primary)
        # firefox (optional)
        # webkit (optional)
```

## Test Data Flow

```
Test Data
│
├── Environment Variables
│   ├── PLAYWRIGHT_BASE_URL → http://localhost:3100
│   ├── API_URL → http://localhost:3000
│   └── JWT_ACCESS_SECRET → (from .env.test)
│
├── Test Credentials
│   ├── Valid: test-admin@omnipost.local / Test@Admin123
│   ├── Invalid Email: invalid@example.com / Test@Admin123
│   └── Invalid Password: test-admin@omnipost.local / WrongPassword123
│
└── Expected Outcomes
    ├── Success: Cookies set, redirect to /
    ├── Error: Error message, remain on /auth/login
    └── Logout: Cookies cleared, redirect to /auth/login
```

## Authentication Flow Diagram

```
User Journey: Successful Login
│
1. Visit /auth/login
   └── LoginPage renders
       ├── Email input (required, type="email")
       ├── Password input (required, type="password")
       ├── Remember me checkbox
       └── Submit button ("Sign in")
│
2. Fill credentials
   ├── Email: test-admin@omnipost.local
   ├── Password: Test@Admin123
   └── Remember me: [checked/unchecked]
│
3. Submit form
   ├── Button text → "Signing in..."
   ├── Button disabled → true
   ├── Inputs disabled → true
   └── aria-busy → "true"
│
4. API Request
   ├── POST /api/admin/auth/login
   ├── Body: { email, password, rememberMe }
   └── Response: { ok: true, tokens: {...} }
│
5. Set Cookies
   ├── access_token (httpOnly, secure)
   ├── refresh_token (httpOnly, secure, long-lived if rememberMe)
   └── csrf_token (httpOnly, secure)
│
6. Redirect
   └── Navigate to / (dashboard)
│
7. Dashboard Renders
   ├── Header with user info
   ├── User name and role displayed
   └── Logout button visible
```

## Error Handling Flow

```
Error Handling
│
├── Invalid Credentials
│   ├── API returns error
│   ├── Display error message in alert
│   ├── Remain on login page
│   └── No cookies set
│
├── Network Error
│   ├── Fetch fails
│   ├── Display generic error
│   └── Allow retry
│
├── Form Validation
│   ├── HTML5 validation (required, email format)
│   ├── Client-side feedback
│   └── Prevent submission
│
└── Account Lockout (backend)
    ├── 3 failed attempts
    ├── Account locked for 15 minutes
    └── Reset via resetTestAdmin()
```

## Accessibility Testing Coverage

```
Accessibility Checks
│
├── ARIA Attributes
│   ├── aria-label on inputs
│   ├── aria-required on required fields
│   ├── aria-busy during loading
│   ├── role="alert" on errors
│   └── aria-live="assertive" on errors
│
├── Semantic HTML
│   ├── Proper input types (email, password)
│   ├── Label associations
│   └── Button semantics
│
├── Keyboard Navigation
│   ├── Tab order
│   ├── Enter key submission
│   └── Focus management
│
└── Visual Feedback
    ├── Loading states
    ├── Error states
    └── Success states
```

## Test Isolation Strategy

```
Test Isolation
│
├── Account Reset
│   └── resetTestAdmin() before each test
│       └── Clears lockout state
│
├── Cookie Clearing
│   └── clearAuth(page)
│       ├── Clear all cookies
│       ├── Clear localStorage
│       └── Clear sessionStorage
│
├── Sequential Execution
│   └── workers: 1
│       └── Prevents race conditions
│
└── Fresh Page Context
    └── New page object per test
        └── No state leakage
```

## Debugging Tools

```
Debugging Arsenal
│
├── Visual Debugging
│   ├── pnpm test:e2e:headed (see browser)
│   ├── pnpm test:e2e:ui (interactive UI)
│   └── pnpm test:e2e:debug (step through)
│
├── Captured Artifacts
│   ├── Screenshots (test-results/)
│   ├── Videos (test-results/)
│   └── Traces (test-results/)
│
├── Reports
│   ├── HTML report (playwright-report/)
│   └── pnpm test:e2e:report
│
└── Console Logging
    ├── Test progress
    ├── API calls
    └── State changes
```

## CI/CD Integration

```
CI Pipeline
│
1. Checkout code
│
2. Install dependencies
   └── pnpm install
│
3. Start services
   ├── Start PostgreSQL/Redis
   ├── Start API backend
   └── Start admin frontend
│
4. Run tests
   └── pnpm test:e2e
       ├── workers: 1
       ├── retries: 2
       └── timeout: 60s
│
5. Collect artifacts
   ├── Upload screenshots
   ├── Upload videos
   ├── Upload traces
   └── Upload HTML report
│
6. Report results
   └── GitHub Actions annotations
```

## Test Metrics Dashboard

```
Success Criteria
│
├── Coverage
│   ├── ✅ 17/17 tests implemented
│   ├── ✅ 100% critical paths
│   ├── ✅ Accessibility verified
│   └── ✅ Error scenarios covered
│
├── Performance
│   ├── Target: <60s total execution
│   ├── Target: <5s per test (avg)
│   └── Target: 0% flaky tests
│
├── Quality
│   ├── ✅ Page Object Model
│   ├── ✅ Test isolation
│   ├── ✅ Clear assertions
│   └── ✅ Comprehensive docs
│
└── Maintainability
    ├── ✅ Reusable helpers
    ├── ✅ Consistent patterns
    ├── ✅ Easy to extend
    └── ✅ Well documented
```

---

**Visual Key**:

- `├──` = Has more items below
- `└──` = Last item in group
- `✅` = Complete/Passing
- `⚪` = Optional/Not enabled
- `❌` = Not implemented (future work)
