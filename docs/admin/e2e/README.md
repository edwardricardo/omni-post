# E2E Authentication Tests

Comprehensive end-to-end tests for the Next.js 15 admin authentication system using Playwright.

## Overview

This test suite provides comprehensive coverage of the authentication flow, including:

- Login page rendering and accessibility
- Valid/invalid login flows
- Form validation and interaction
- Loading states and transitions
- Session persistence and management
- Remember me functionality
- Protected routes and redirects
- Logout functionality

## Test Structure

### Files

- **`auth.spec.ts`** - Main authentication test suite (17 test cases)
- **`fixtures/LoginPage.ts`** - Page Object Model for login interactions
- **`helpers.ts`** - Utility functions for test setup and assertions
- **`README.md`** - This file

### Test Categories

1. **Login Page** (4 tests)
   - Rendering and layout
   - Accessibility attributes
   - Form validation
   - Focus management

2. **Valid Login** (3 tests)
   - Successful authentication flow
   - Cookie management
   - User info display
   - Already authenticated redirect

3. **Invalid Login** (3 tests)
   - Invalid email handling
   - Invalid password handling
   - User-friendly error messages

4. **Remember Me** (2 tests)
   - Long-term session with remember me
   - Session-only without remember me

5. **Loading States** (2 tests)
   - Loading indicators during submission
   - Form disabled state

6. **Form Interaction** (1 test)
   - Enter key submission

7. **Protected Routes** (2 tests)
   - Unauthenticated redirect
   - Post-login redirect to original destination

8. **Logout** (2 tests)
   - Successful logout flow
   - Session clearing

9. **Session Persistence** (2 tests)
   - Session across page reloads
   - Session across navigation

## Prerequisites

### Services Required

Before running tests, ensure these services are running:

1. **Admin Frontend** - `http://localhost:3100`

   ```bash
   pnpm --filter @apps/admin dev
   ```

2. **API Backend** - `http://localhost:3000`

   ```bash
   pnpm --filter @apps/api dev
   ```

3. **Database** - PostgreSQL and Redis
   ```bash
   pnpm db:up
   ```

### Test Admin Account

Tests use a dedicated test admin account:

- **Email**: `test-admin@omnipost.local`
- **Password**: `Test@Admin123`
- **Role**: `SUPER_ADMIN`

This account is automatically reset before each test to avoid lockout issues.

## Running Tests

### Basic Commands

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests in UI mode (interactive)
pnpm test:e2e:ui

# Run tests in headed mode (see browser)
pnpm test:e2e:headed

# Run specific test file
pnpm test:e2e auth.spec.ts

# Debug tests
pnpm test:e2e:debug

# View last test report
pnpm test:e2e:report
```

### Advanced Options

```bash
# Run tests with specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Run specific test by name
npx playwright test -g "should login successfully"

# Run tests with trace
npx playwright test --trace on

# Update snapshots
npx playwright test --update-snapshots
```

## Configuration

### Playwright Config (`playwright.config.ts`)

Key configuration settings:

- **Base URL**: `http://localhost:3100`
- **Timeout**: 60 seconds per test
- **Workers**: 1 (sequential execution to avoid race conditions)
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: On failure
- **Video**: Retain on failure
- **Trace**: On first retry

### Environment Variables

```bash
# Override base URL
PLAYWRIGHT_BASE_URL=http://localhost:3100

# Override API URL
API_URL=http://localhost:3000

# CI mode (enables retries and GitHub reporter)
CI=true
```

## Test Patterns

### Page Object Model

Tests use the Page Object Model pattern for maintainability:

```typescript
import { LoginPage } from "./fixtures/LoginPage";

test("example", async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login("email@example.com", "password");
});
```

### Helper Functions

Common operations are abstracted into helper functions:

```typescript
import { loginAs, clearAuth, verifyAuthCookies } from "./helpers";

// Login as user
await loginAs(page, "email@example.com", "password");

// Clear authentication
await clearAuth(page);

// Verify cookies are set correctly
await verifyAuthCookies(page);
```

### Test Isolation

Each test is isolated using:

1. **beforeEach hooks** - Reset test admin account and clear auth
2. **Sequential execution** - Workers: 1 to avoid race conditions
3. **Cookie clearing** - Ensure clean state between tests

## Debugging

### Debug Mode

Run tests in debug mode to step through execution:

```bash
pnpm test:e2e:debug
```

This opens Playwright Inspector where you can:

- Step through tests line by line
- Inspect element selectors
- View console logs
- Take screenshots

### Headed Mode

See the browser while tests run:

```bash
pnpm test:e2e:headed
```

### Screenshots and Videos

Test artifacts are saved in:

- **Screenshots**: `test-results/` (on failure)
- **Videos**: `test-results/` (on failure)
- **Traces**: `test-results/` (on first retry)
- **HTML Report**: `playwright-report/`

View HTML report:

```bash
pnpm test:e2e:report
```

### Console Logs

Add debug logging in tests:

```typescript
console.log("Debug info:", await page.title());
await page.screenshot({ path: "debug.png" });
```

## Common Issues

### Test Admin Lockout

If tests fail due to account lockout:

```bash
# Reset test admin manually via API
curl -X POST http://localhost:3000/api/admin/auth/test/reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@omnipost.local"}'
```

### Service Not Running

Ensure all services are running:

```bash
# Check admin (should return login page)
curl http://localhost:3100/auth/login

# Check API (should return health check)
curl http://localhost:3000/health
```

### Port Conflicts

If ports are in use:

```bash
# Kill processes on ports
lsof -ti:3100 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Browser Issues

Reinstall Playwright browsers:

```bash
npx playwright install --with-deps
```

## CI/CD Integration

### GitHub Actions

Tests automatically run in CI with:

- 2 retries for flaky test tolerance
- GitHub reporter for inline annotations
- Artifact upload for failed test evidence

Example workflow:

```yaml
- name: Run E2E tests
  run: pnpm test:e2e
  env:
    CI: true
    PLAYWRIGHT_BASE_URL: http://localhost:3100
    API_URL: http://localhost:3000

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Coverage

Current test coverage:

- **17 test cases** covering core authentication flows
- **100% of critical user paths** (login, logout, session management)
- **Accessibility testing** (ARIA attributes, labels, focus)
- **Error handling** (invalid credentials, form validation)
- **Session persistence** (cookies, redirects, remember me)

## Future Enhancements

Planned test additions:

- [ ] MFA flow testing (when frontend implemented)
- [ ] RBAC permission testing
- [ ] Password reset flow
- [ ] Account lockout after 3 failed attempts
- [ ] Session timeout testing
- [ ] Cross-browser testing (Firefox, Safari)
- [ ] Mobile viewport testing
- [ ] Performance testing (First Contentful Paint, Time to Interactive)
- [ ] Visual regression testing

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
- [Accessibility Testing](https://playwright.dev/docs/accessibility-testing)
