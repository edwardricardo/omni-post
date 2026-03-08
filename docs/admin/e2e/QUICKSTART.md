# E2E Tests Quick Start Guide

Get up and running with E2E authentication tests in 5 minutes.

## 1. Prerequisites Check

Ensure you have the following installed:

```bash
# Node.js 20+
node --version

# pnpm
pnpm --version

# Playwright browsers (install if needed)
npx playwright install --with-deps chromium
```

## 2. Start Required Services

Open **three separate terminals**:

### Terminal 1: Database Services

```bash
cd /home/edward/projects/omni-post
pnpm db:up
```

Wait for PostgreSQL and Redis to be ready.

### Terminal 2: API Backend

```bash
cd /home/edward/projects/omni-post
pnpm --filter @apps/api dev
```

Wait for API to start on `http://localhost:3000`

### Terminal 3: Admin Frontend

```bash
cd /home/edward/projects/omni-post/apps/admin
pnpm dev
```

Wait for Next.js to start on `http://localhost:3100`

## 3. Verify Services

Quick health check:

```bash
# Check API
curl http://localhost:3000/health

# Check Admin (should return HTML)
curl http://localhost:3100/auth/login -I
```

## 4. Run Tests

### Run All Tests

```bash
cd /home/edward/projects/omni-post/apps/admin
pnpm test:e2e
```

### Run with UI (Recommended for First Time)

```bash
pnpm test:e2e:ui
```

This opens an interactive UI where you can:

- See all tests
- Run individual tests
- Watch tests execute in browser
- Inspect failures

### Run in Headed Mode (See Browser)

```bash
pnpm test:e2e:headed
```

### View Test Report

After running tests:

```bash
pnpm test:e2e:report
```

## 5. Expected Results

You should see output like:

```
Running 17 tests using 1 worker

✓ Authentication Flow › Login Page › should render login page correctly
✓ Authentication Flow › Login Page › should have proper accessibility attributes
✓ Authentication Flow › Valid Login › should login successfully with valid credentials
✓ Authentication Flow › Invalid Login › should show error for invalid email
... (13 more tests)

17 passed (45s)
```

## Common Commands

```bash
# Run specific test
pnpm test:e2e auth.spec.ts

# Run specific test by name
npx playwright test -g "should login successfully"

# Debug mode
pnpm test:e2e:debug

# Update snapshots (if any)
npx playwright test --update-snapshots
```

## Troubleshooting

### Tests Fail: "Target closed"

**Cause**: Services not running or wrong URL

**Solution**:

```bash
# Verify admin is running
curl http://localhost:3100/auth/login -I

# Verify API is running
curl http://localhost:3000/health
```

### Tests Fail: "Account locked"

**Cause**: Test admin account is locked after multiple failed attempts

**Solution**:

```bash
# Reset test admin via API
curl -X POST http://localhost:3000/api/admin/auth/test/reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@omnipost.local"}'
```

### Tests Fail: "Timeout waiting for selector"

**Cause**: Slow page load or missing elements

**Solution**:

```bash
# Run in headed mode to see what's happening
pnpm test:e2e:headed

# Or run in debug mode
pnpm test:e2e:debug
```

### Port Already in Use

```bash
# Kill processes on ports
lsof -ti:3100 | xargs kill -9  # Admin
lsof -ti:3000 | xargs kill -9  # API
```

### Playwright Browsers Missing

```bash
# Reinstall Playwright browsers
npx playwright install --with-deps
```

## Test Coverage Summary

The test suite covers:

- ✅ Login page rendering and accessibility (4 tests)
- ✅ Valid login flow with cookie management (3 tests)
- ✅ Invalid login with error handling (3 tests)
- ✅ Remember me functionality (2 tests)
- ✅ Loading states and UI feedback (2 tests)
- ✅ Form interaction (Enter key submission) (1 test)
- ✅ Protected routes and redirects (2 tests)
- ✅ Logout flow and session clearing (2 tests)
- ✅ Session persistence across reloads (2 tests)

**Total: 17 comprehensive test cases**

## Next Steps

1. ✅ Run tests locally to verify everything works
2. ✅ Review test code in `tests/e2e/auth.spec.ts`
3. ✅ Explore Page Object Model in `tests/e2e/fixtures/LoginPage.ts`
4. ✅ Read full documentation in `tests/e2e/README.md`
5. 🔄 Integrate tests into CI/CD pipeline
6. 🔄 Add MFA tests when frontend is ready
7. 🔄 Add RBAC permission tests

## Help

For more details, see:

- Full documentation: `tests/e2e/README.md`
- Playwright docs: https://playwright.dev/
- Report issues: Create GitHub issue with test logs
