# First Run Checklist

Complete checklist for running E2E authentication tests for the first time.

## Pre-Flight Checklist

### 1. System Requirements ✓

- [ ] Node.js 20+ installed (`node --version`)
- [ ] pnpm installed (`pnpm --version`)
- [ ] Docker installed and running (`docker --version`)
- [ ] Git repository cloned
- [ ] Terminal multiplexer or multiple terminal windows available

### 2. Project Setup ✓

- [ ] Navigate to project root: `cd /home/edward/projects/omni-post`
- [ ] Dependencies installed: `pnpm install`
- [ ] Build completed: `pnpm build` (if needed)
- [ ] Environment variables configured (`.env` files)

### 3. Database Setup ✓

- [ ] Docker Compose file exists: `docker-compose.yml`
- [ ] Database services started: `pnpm db:up`
- [ ] PostgreSQL is running: `docker ps | grep postgres`
- [ ] Redis is running: `docker ps | grep redis`
- [ ] Database migrated: `pnpm db:migrate` (if needed)

### 4. Playwright Setup ✓

- [ ] Playwright installed: `npx playwright --version`
- [ ] Browsers installed: `npx playwright install --with-deps chromium`
- [ ] Playwright config exists: `apps/admin/playwright.config.ts`

### 5. Test Admin Account ✓

Backend should have test admin account with:

- [ ] Email: `test-admin@omnipost.local`
- [ ] Password: `Test@Admin123`
- [ ] Role: `SUPER_ADMIN`
- [ ] Reset endpoint available: `POST /api/admin/auth/test/reset`

---

## Service Startup Checklist

### Terminal 1: Database Services

```bash
cd /home/edward/projects/omni-post
pnpm db:up
```

**Verify:**

- [ ] PostgreSQL started on port 5432
- [ ] Redis started on port 6379
- [ ] No error messages in logs
- [ ] Services show as "healthy" in Docker

**Check Command:**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected output includes:

- `omni-post-postgres` - Up - `0.0.0.0:5432->5432/tcp`
- `omni-post-redis` - Up - `0.0.0.0:6379->6379/tcp`

---

### Terminal 2: API Backend

```bash
cd /home/edward/projects/omni-post
pnpm --filter @apps/api dev
```

**Verify:**

- [ ] API started on port 3000
- [ ] No TypeScript compilation errors
- [ ] No database connection errors
- [ ] Health endpoint responds

**Check Command:**

```bash
curl http://localhost:3000/health
```

Expected output:

```json
{ "status": "ok", "timestamp": "..." }
```

**Also verify:**

```bash
curl http://localhost:3000/api/admin/auth/test/reset -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@omnipost.local"}'
```

Should return success response (or 404 if endpoint not implemented yet).

---

### Terminal 3: Admin Frontend

```bash
cd /home/edward/projects/omni-post/apps/admin
pnpm dev
```

**Verify:**

- [ ] Next.js started on port 3100
- [ ] No compilation errors
- [ ] No missing module errors
- [ ] Login page loads

**Check Command:**

```bash
curl -I http://localhost:3100/auth/login
```

Expected output:

```
HTTP/1.1 200 OK
Content-Type: text/html
...
```

**Manual Browser Check:**

1. [ ] Open: http://localhost:3100/auth/login
2. [ ] Login form is visible
3. [ ] Email and password inputs present
4. [ ] "Remember me" checkbox present
5. [ ] "Sign in" button present

---

## Test Execution Checklist

### Pre-Test Verification

Before running tests, verify all services are healthy:

```bash
# Check all services
./check-services.sh  # Or run these commands:

# Database
docker ps | grep postgres  # Should show running
docker ps | grep redis     # Should show running

# API Backend
curl http://localhost:3000/health  # Should return {"status":"ok"}

# Admin Frontend
curl -I http://localhost:3100/auth/login  # Should return 200 OK
```

- [ ] All services respond successfully
- [ ] No error messages in any terminal
- [ ] CPU/Memory usage is normal

---

### First Test Run (Recommended: UI Mode)

**Terminal 4: Test Runner**

```bash
cd /home/edward/projects/omni-post/apps/admin
pnpm test:e2e:ui
```

**What to expect:**

1. [ ] Playwright UI opens in browser
2. [ ] 17 tests are listed in sidebar
3. [ ] Tests are organized into 9 suites
4. [ ] No immediate errors

**Interactive Testing:**

1. [ ] Click "Run all tests" button
2. [ ] Watch tests execute in real-time
3. [ ] Observe browser automation
4. [ ] Check test results

**Expected Results:**

- [ ] All 17 tests pass (green checkmarks)
- [ ] Total execution time: ~30-60 seconds
- [ ] No red failures
- [ ] No flaky tests (intermittent failures)

**If tests fail:**

1. [ ] Click failed test to see details
2. [ ] Review error message
3. [ ] Check screenshot/video if available
4. [ ] Verify services are still running
5. [ ] Check terminal logs for errors

---

### Second Test Run (Headless Mode)

After UI mode succeeds, try headless:

```bash
cd /home/edward/projects/omni-post/apps/admin
pnpm test:e2e
```

**Expected Output:**

```
Running 17 tests using 1 worker

✓ Authentication Flow › Login Page › should render login page correctly (1.2s)
✓ Authentication Flow › Login Page › should have proper accessibility attributes (0.8s)
✓ Authentication Flow › Login Page › should have proper form validation attributes (0.6s)
✓ Authentication Flow › Login Page › should focus on email field on load (0.7s)
✓ Authentication Flow › Valid Login › should login successfully with valid credentials (2.1s)
✓ Authentication Flow › Valid Login › should redirect to dashboard if already authenticated (1.5s)
✓ Authentication Flow › Valid Login › should display user info on dashboard after login (1.8s)
✓ Authentication Flow › Invalid Login › should show error for invalid email (1.3s)
✓ Authentication Flow › Invalid Login › should show error for invalid password (1.2s)
✓ Authentication Flow › Invalid Login › should show user-friendly error messages (1.1s)
✓ Authentication Flow › Remember Me Functionality › should respect remember me checkbox (2.0s)
✓ Authentication Flow › Remember Me Functionality › should handle session without remember me (1.7s)
✓ Authentication Flow › Loading States › should show loading state during login (1.5s)
✓ Authentication Flow › Loading States › should disable form during submission (1.3s)
✓ Authentication Flow › Form Interaction › should submit form on Enter key press (1.6s)
✓ Authentication Flow › Protected Routes › should redirect to login when accessing protected route (1.4s)
✓ Authentication Flow › Protected Routes › should redirect to originally requested page after login (1.9s)

17 passed (45.3s)

To open last HTML report run:

  npx playwright show-report
```

**Verify:**

- [ ] All 17 tests passed
- [ ] No failures or timeouts
- [ ] Execution time: 30-60 seconds
- [ ] HTML report generated

---

### View Test Report

```bash
pnpm test:e2e:report
```

**In the report:**

- [ ] All tests show green (passed)
- [ ] No red tests (failed)
- [ ] Execution timeline looks reasonable
- [ ] No screenshots (only generated on failure)

---

## Troubleshooting Checklist

### If Tests Fail: "Target closed" or "Page closed"

**Cause:** Frontend not running or crashed

**Fix:**

- [ ] Check Terminal 3 for errors
- [ ] Restart admin frontend: `pnpm dev`
- [ ] Verify: `curl -I http://localhost:3100/auth/login`
- [ ] Re-run tests

---

### If Tests Fail: "Network error" or "ECONNREFUSED"

**Cause:** Backend not running or not responding

**Fix:**

- [ ] Check Terminal 2 for errors
- [ ] Restart API backend: `pnpm --filter @apps/api dev`
- [ ] Verify: `curl http://localhost:3000/health`
- [ ] Re-run tests

---

### If Tests Fail: "Account locked" or "Too many attempts"

**Cause:** Test admin account locked after failed logins

**Fix:**

```bash
# Reset test admin account
curl -X POST http://localhost:3000/api/admin/auth/test/reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@omnipost.local"}'

# Re-run tests
pnpm test:e2e
```

---

### If Tests Fail: "Timeout waiting for..."

**Cause:** Page loading too slowly or element not appearing

**Fix:**

1. [ ] Run in headed mode to see what's happening:

   ```bash
   pnpm test:e2e:headed
   ```

2. [ ] Check for JavaScript errors in browser console

3. [ ] Verify page loads manually:
   - Open: http://localhost:3100/auth/login
   - Check browser console for errors

4. [ ] Increase timeout in test if legitimately slow

---

### If Tests Fail: "Database connection error"

**Cause:** PostgreSQL not running or not accessible

**Fix:**

- [ ] Check Terminal 1 for database errors
- [ ] Restart database: `pnpm db:up`
- [ ] Verify: `docker ps | grep postgres`
- [ ] Check connection: `pnpm --filter @apps/api db:studio`

---

### If Tests Are Flaky (Pass sometimes, fail sometimes)

**Investigation:**

1. [ ] Run tests multiple times: `pnpm test:e2e` (3x)
2. [ ] Note which tests fail
3. [ ] Run in debug mode: `pnpm test:e2e:debug`
4. [ ] Review timing-sensitive assertions

**Common causes:**

- [ ] Race conditions in loading states
- [ ] Network timing variations
- [ ] Insufficient wait conditions
- [ ] Test admin account state issues

**Fix:**

- [ ] Ensure `workers: 1` in config (already set)
- [ ] Add more robust wait conditions
- [ ] Increase specific timeouts if needed

---

## Post-Test Cleanup Checklist

### Optional: Stop All Services

If you want to stop services after testing:

**Terminal 1 (Database):**

```bash
# Press Ctrl+C, then:
docker-compose down
```

**Terminal 2 (API):**

```bash
# Press Ctrl+C
```

**Terminal 3 (Admin):**

```bash
# Press Ctrl+C
```

### Cleanup Test Artifacts

```bash
cd /home/edward/projects/omni-post/apps/admin

# Remove test artifacts (optional)
rm -rf test-results/
rm -rf playwright-report/
```

---

## Success Criteria Summary

### ✅ Tests are successful if:

- [ ] **All 17 tests pass** in headless mode
- [ ] **Execution time** is 30-60 seconds
- [ ] **No flaky tests** (consistent results across runs)
- [ ] **HTML report** shows all green
- [ ] **No screenshots generated** (only created on failure)
- [ ] **No errors** in service logs during test run

### ✅ System is healthy if:

- [ ] **Database services** running and responding
- [ ] **API backend** accessible on port 3000
- [ ] **Admin frontend** accessible on port 3100
- [ ] **Test admin account** can log in manually
- [ ] **No memory leaks** (services don't consume excessive RAM)
- [ ] **No connection errors** in any logs

---

## Next Steps After Successful Test Run

### 1. Documentation Review

- [ ] Read full docs: `tests/e2e/README.md`
- [ ] Review test code: `tests/e2e/auth.spec.ts`
- [ ] Understand Page Object: `tests/e2e/fixtures/LoginPage.ts`

### 2. CI/CD Integration

- [ ] Add tests to GitHub Actions workflow
- [ ] Configure test artifacts upload
- [ ] Set up test reporting in PR checks

### 3. Continuous Testing

- [ ] Run tests before committing code
- [ ] Run tests after pulling changes
- [ ] Run tests before deploying

### 4. Test Expansion

- [ ] Add MFA tests when frontend ready
- [ ] Add RBAC tests for permissions
- [ ] Add performance tests
- [ ] Add visual regression tests

---

## Quick Reference Commands

```bash
# Start all services (3 terminals)
pnpm db:up                          # Terminal 1
pnpm --filter @apps/api dev         # Terminal 2
pnpm --filter @apps/admin dev       # Terminal 3

# Run tests (Terminal 4)
pnpm test:e2e                       # Headless
pnpm test:e2e:ui                    # Interactive UI
pnpm test:e2e:headed                # See browser
pnpm test:e2e:debug                 # Step through

# View results
pnpm test:e2e:report                # HTML report

# Troubleshooting
curl http://localhost:3000/health           # Check API
curl -I http://localhost:3100/auth/login    # Check Admin
docker ps                                    # Check Database

# Reset test admin
curl -X POST http://localhost:3000/api/admin/auth/test/reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@omnipost.local"}'
```

---

**Ready to start?** Follow each section checkbox by checkbox, and you'll have tests running in no time!

**Estimated Time**: 10-15 minutes for first-time setup
**Estimated Test Run Time**: 30-60 seconds

**Status**:

- [ ] Pre-flight checks complete
- [ ] Services started
- [ ] Tests run successfully
- [ ] Results reviewed
- [ ] Ready for CI/CD integration
