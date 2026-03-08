# E2E Testing Framework

This directory contains the comprehensive End-to-End (E2E) testing framework for the social media CMS platform using Playwright with TypeScript.

## Overview

The E2E testing framework provides:

- **Multi-browser testing** (Chromium, Firefox, WebKit)
- **Mobile and tablet testing** with device emulation
- **Accessibility testing** with axe-core integration
- **Visual regression testing** with screenshot comparison
- **Performance testing** and monitoring
- **Page Object Model** architecture for maintainable tests
- **CI/CD integration** with GitHub Actions

## Architecture

```
tests/e2e/
├── config/                    # Test configuration
│   ├── playwright.config.ts   # Main Playwright configuration
│   ├── global-setup.ts       # Global setup and authentication
│   ├── global-teardown.ts    # Global cleanup
│   └── test-setup.ts         # Custom test fixtures and helpers
├── pages/                     # Page Object Models
│   ├── BasePage.ts           # Base page with common functionality
│   ├── AuthPage.ts           # Authentication flows
│   ├── DashboardPage.ts      # Dashboard navigation
│   ├── PublishingPage.ts     # Post creation and publishing
│   └── AnalyticsPage.ts      # Analytics dashboard
├── tests/                     # Test specifications
│   ├── auth.spec.ts          # Authentication tests
│   ├── publishing.spec.ts    # Publishing workflow tests
│   ├── analytics.spec.ts     # Analytics functionality tests
│   ├── visual.spec.ts        # Visual regression tests
│   └── visual.spec.ts-snapshots/ # Visual baseline screenshots
├── fixtures/                  # Test data and authentication
│   ├── test-data.ts          # Test data fixtures
│   ├── test-user-auth.json   # User authentication state
│   ├── test-admin-auth.json  # Admin authentication state
│   └── images/               # Test image assets
└── utils/                     # Helper utilities
    ├── helpers.ts            # Common test helpers
    └── assertions.ts         # Custom assertions
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm package manager
- PostgreSQL and Redis for test environment
- API and client applications running

### Installation

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm --filter @apps/client exec playwright install
```

### Environment Setup

1. Create test environment variables:

```bash
cp .env.example .env.test
```

2. Configure test database:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/omni_post_test
REDIS_URL=redis://localhost:6379
NODE_ENV=test
BASE_URL=http://localhost:3200
API_BASE_URL=http://localhost:3000
```

3. Start the development environment:

```bash
# Start database services
pnpm db:up

# Start API server (in one terminal)
pnpm dev:api

# Start client application (in another terminal)
pnpm --filter @apps/client dev
```

## Running Tests

### Basic Commands

```bash
# Run all E2E tests
pnpm --filter @apps/client test:e2e

# Run tests with UI (interactive mode)
pnpm --filter @apps/client test:e2e:ui

# Run tests in headed mode (visible browser)
pnpm --filter @apps/client test:e2e:headed

# Debug tests step by step
pnpm --filter @apps/client test:e2e:debug
```

### Specific Test Suites

```bash
# Authentication tests only
pnpm --filter @apps/client test:e2e:auth

# Publishing workflow tests
pnpm --filter @apps/client test:e2e:publishing

# Analytics dashboard tests
pnpm --filter @apps/client test:e2e:analytics
```

### Browser-Specific Testing

```bash
# Mobile testing
pnpm --filter @apps/client test:e2e:mobile

# Accessibility testing
pnpm --filter @apps/client test:e2e:accessibility

# Visual regression testing
pnpm --filter @apps/client test:e2e:visual
```

### View Test Reports

```bash
# Open HTML report
pnpm --filter @apps/client test:e2e:report
```

## Test Structure

### Page Object Models

Each page follows the Page Object Model pattern:

```typescript
// Example: AuthPage.ts
import { Page, Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

export class AuthPage extends BasePage {
  get emailInput(): Locator {
    return this.page.locator('[data-testid="email-input"]');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
```

### Test Specifications

Tests are organized by functionality:

```typescript
// Example: auth.spec.ts
import { test, expect } from "../config/test-setup";
import { AuthPage } from "../pages/AuthPage";

test.describe("Authentication", () => {
  test("should login with valid credentials", async ({ page }) => {
    const authPage = new AuthPage(page);

    await authPage.goToLogin();
    await authPage.loginWithValidCredentials();
    await authPage.expectSuccessfulLogin();
  });
});
```

### Custom Fixtures

Extended test fixtures provide additional functionality:

```typescript
// Using custom fixtures
test("should create post", async ({ authenticatedPage, testData }) => {
  const project = await testData.createTestProject();
  const publishingPage = new PublishingPage(authenticatedPage);

  await publishingPage.createBasicTextPost("Test content");
});
```

## Test Data Management

### Fixtures

Test data is defined in `fixtures/test-data.ts`:

```typescript
export const TestUsers = {
  standardUser: {
    email: "e2e-test-user@example.com",
    password: "Test123!@#",
    role: "user",
  },
  adminUser: {
    email: "e2e-admin-user@example.com",
    password: "Admin123!@#",
    role: "admin",
  },
};

export const TestPosts = {
  textPost: (projectId: string) => ({
    content: "Test post content #automation",
    status: "DRAFT",
    projectId,
  }),
};
```

### Dynamic Test Data

Create test data dynamically:

```typescript
test("should create post", async ({ testData }) => {
  const project = await testData.createTestProject();
  const post = await testData.createTestPost(project.id);

  // Use the created data in test
});
```

### Authentication State

Tests can use pre-authenticated states:

```typescript
// Use authenticated user
test("should access dashboard", async ({ authenticatedPage }) => {
  await authenticatedPage.goto("/dashboard");
  // User is already logged in
});

// Use admin user
test("should access admin features", async ({ adminPage }) => {
  await adminPage.goto("/admin");
  // Admin user is already logged in
});
```

## Test Categories

### Authentication Tests (`auth.spec.ts`)

- Login/logout flows
- Registration process
- Password reset functionality
- Multi-factor authentication
- Session management
- Social login integration

### Publishing Tests (`publishing.spec.ts`)

- Post creation and editing
- Media upload and management
- Channel selection
- Scheduling functionality
- Auto-save features
- Cross-platform publishing
- Content validation

### Analytics Tests (`analytics.spec.ts`)

- Dashboard overview
- Metrics visualization
- Chart interactions
- Date range filtering
- Report generation
- Performance monitoring
- Data export functionality

### Visual Regression Tests (`visual.spec.ts`)

- Screenshot baseline capture
- Visual comparison across pages
- Layout consistency validation
- Responsive design verification
- Snapshot management and updates

## Accessibility Testing

Accessibility tests use axe-core integration:

```typescript
test("should be accessible", async ({ page, axeBuilder }) => {
  await page.goto("/dashboard");

  const accessibilityScanResults = await axeBuilder.analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});
```

### WCAG Compliance

Tests validate:

- WCAG 2.1 AA compliance
- Keyboard navigation
- Screen reader compatibility
- Color contrast ratios
- Focus management

## Visual Regression Testing

Visual tests capture and compare screenshots:

```typescript
test("should match visual baseline", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveScreenshot("dashboard.png");
});
```

### Visual Testing Guidelines

- Use consistent viewport sizes
- Wait for animations to complete
- Mask dynamic content (timestamps, user-specific data)
- Update baselines when UI changes are intentional

## Performance Testing

Performance tests monitor key metrics:

```typescript
test("should load quickly", async ({ page }) => {
  const startTime = Date.now();

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000); // 3 seconds
});
```

### Performance Metrics

- Page load time
- Time to interactive
- First contentful paint
- Memory usage
- Network requests

## Mobile Testing

Mobile tests use device emulation:

```typescript
test("should work on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto("/dashboard");
  // Test mobile-specific functionality
});
```

### Mobile Test Coverage

- Responsive design
- Touch interactions
- Mobile navigation
- Viewport adaptation
- Performance on mobile networks

## CI/CD Integration

### GitHub Actions

The E2E tests run automatically on:

- Push to main/develop branches
- Pull requests
- Nightly scheduled runs
- Manual triggers

### Test Matrix

Tests run across multiple configurations:

- **Browsers**: Chromium, Firefox, WebKit
- **Devices**: Desktop, tablet, mobile
- **Test Types**: Functional, accessibility, visual, performance

### Reporting

- HTML reports with screenshots and videos
- JUnit XML for CI integration
- GitHub PR comments with results
- Artifact uploads for failed tests

## Best Practices

### Writing Tests

1. **Use data-testid attributes** for reliable element selection
2. **Follow Page Object Model** patterns for maintainability
3. **Keep tests independent** - each test should be able to run in isolation
4. **Use meaningful descriptions** for test names and assertions
5. **Handle async operations** properly with appropriate waits

### Test Data

1. **Use fixtures** for consistent test data
2. **Clean up** test data after tests complete
3. **Avoid hardcoded values** - use configuration and generators
4. **Isolate test data** - each test should use unique data

### Debugging

1. **Use headed mode** to see browser interactions
2. **Add console logs** for debugging complex interactions
3. **Take screenshots** on failures for visual debugging
4. **Use browser developer tools** during debug mode

### Performance

1. **Minimize test execution time** by grouping related tests
2. **Use appropriate timeouts** for different operations
3. **Parallel execution** for independent tests
4. **Efficient selectors** to reduce wait times

## Troubleshooting

### Common Issues

**Tests fail intermittently:**

- Increase timeouts for slow operations
- Add explicit waits for async operations
- Check for race conditions in test setup

**Elements not found:**

- Verify data-testid attributes exist
- Check for dynamic content loading
- Ensure proper wait conditions

**Authentication failures:**

- Verify auth tokens are valid
- Check test user credentials
- Ensure auth state files are accessible

**Performance issues:**

- Monitor test execution times
- Optimize test setup and teardown
- Use parallel execution judiciously

### Debug Commands

```bash
# Run single test with debug
pnpm --filter @apps/client test:e2e --debug tests/e2e/tests/auth.spec.ts

# Run with verbose output
pnpm --filter @apps/client test:e2e --reporter=verbose

# Generate trace files
pnpm --filter @apps/client test:e2e --trace=on
```

## Maintenance

### Regular Tasks

1. **Update test data** when application data models change
2. **Review and update** visual regression baselines
3. **Monitor test execution times** and optimize slow tests
4. **Update browser versions** and Playwright dependencies
5. **Review accessibility rules** and update as standards evolve

### Monitoring

- Track test execution times
- Monitor flaky test rates
- Review coverage reports
- Analyze failure patterns

## Contributing

When adding new tests:

1. Follow existing patterns and naming conventions
2. Add appropriate documentation and comments
3. Ensure tests are cross-browser compatible
4. Include accessibility checks where relevant
5. Update this README if adding new capabilities

For questions or issues with the E2E testing framework, please create an issue in the project repository.
