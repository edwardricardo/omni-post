// Test aggregator with proper async handling and timeout management

// Test configuration
const GLOBAL_TIMEOUT = 30000; // 30 seconds total timeout
const TEST_TIMEOUT = 10000; // 10 seconds per test

interface TestModule {
  name: string;
  path: string;
  enabled: boolean;
}

const TEST_MODULES: TestModule[] = [
  // Core API Tests (only include tests that actually exist)
  { name: "Plan Publication", path: "./planPublication.test.ts", enabled: true },
  { name: "Adapters", path: "./adapters.test.ts", enabled: true },
  { name: "Media Flow", path: "./media.flow.test.ts", enabled: true },
  { name: "Schedule Flow", path: "./schedule.flow.test.ts", enabled: true },
  { name: "Analytics Flow", path: "./analytics.flow.test.ts", enabled: true },
  { name: "Rate Limit Smoke", path: "./rateLimit.smoke.test.ts", enabled: true },

  // Threading Tests
  { name: "Threading Planner", path: "./threading.planner.test.ts", enabled: true },
  { name: "Threading X Provider", path: "./threading.xprovider.test.ts", enabled: true },
  { name: "Threading Canonical", path: "./threading.canonical.test.ts", enabled: true },

  // Multi-Project Tests
  { name: "Multi-Project Flow", path: "./multiproject.flow.test.ts", enabled: true },

  // Security & Auth Tests (restored files)
  { name: "Security", path: "./security.test.ts", enabled: true },
  { name: "Authentication", path: "./auth.test.ts", enabled: true },
  { name: "MFA", path: "./mfa.test.ts", enabled: true },
  { name: "RBAC", path: "./rbac.test.ts", enabled: true },

  // Account Management Tests (restored files)
  { name: "Account Lifecycle", path: "./accountLifecycle.test.ts", enabled: true },
  { name: "Trial Period", path: "./trialPeriod.test.ts", enabled: true },

  // Infrastructure Tests (restored files)
  { name: "Audit", path: "./audit.test.ts", enabled: true },
  { name: "Schema Utils", path: "./schemaUtils.test.ts", enabled: true },
  { name: "Provider Registry", path: "./providerRegistry.test.ts", enabled: true },

  // Integration Tests (restored files)
  {
    name: "Universal Client Dashboard Integration",
    path: "./universal-client-dashboard.integration.test.ts",
    enabled: true,
  },
];

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
}

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

// Track global state
let testResults: TestResult[] = [];
let startTime = Date.now();

async function runSingleTest(testModule: TestModule): Promise<TestResult> {
  const testStartTime = Date.now();

  try {
    console.log(`${colors.blue}▶ Running ${testModule.name}...${colors.reset}`);

    // Dynamic import with timeout
    const modulePromise = import(testModule.path);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Test timeout after ${TEST_TIMEOUT}ms`)), TEST_TIMEOUT);
    });

    await Promise.race([modulePromise, timeoutPromise]);

    const duration = Date.now() - testStartTime;
    console.log(`${colors.green}✓ ${testModule.name} passed (${duration}ms)${colors.reset}`);

    return {
      name: testModule.name,
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - testStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(`${colors.red}✗ ${testModule.name} failed (${duration}ms)${colors.reset}`);
    console.log(`${colors.red}  Error: ${errorMessage}${colors.reset}`);

    return {
      name: testModule.name,
      success: false,
      duration,
      error: errorMessage,
    };
  }
}

async function runAllTests(): Promise<void> {
  console.log(`${colors.bold}${colors.blue}🧪 Running Test Suite${colors.reset}`);
  console.log(`${colors.blue}Found ${TEST_MODULES.length} test modules${colors.reset}\n`);

  const enabledTests = TEST_MODULES.filter((test) => test.enabled);

  for (const testModule of enabledTests) {
    const result = await runSingleTest(testModule);
    testResults.push(result);

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Print summary
  const totalDuration = Date.now() - startTime;
  const passed = testResults.filter((r) => r.success).length;
  const failed = testResults.filter((r) => !r.success).length;

  console.log(`\n${colors.bold}📊 Test Summary${colors.reset}`);
  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);
  console.log(`${colors.blue}⏱ Total Duration: ${totalDuration}ms${colors.reset}`);

  if (failed > 0) {
    console.log(`\n${colors.red}Failed Tests:${colors.reset}`);
    testResults
      .filter((r) => !r.success)
      .forEach((result) => {
        console.log(`${colors.red}  • ${result.name}: ${result.error}${colors.reset}`);
      });
    process.exit(1);
  } else {
    console.log(`\n${colors.green}🎉 All tests passed!${colors.reset}`);
    process.exit(0);
  }
}

// Handle global timeout
setTimeout(() => {
  console.log(`${colors.red}❌ Global timeout reached (${GLOBAL_TIMEOUT}ms)${colors.reset}`);
  process.exit(1);
}, GLOBAL_TIMEOUT);

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error(`${colors.red}Uncaught Exception: ${error.message}${colors.reset}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`${colors.red}Unhandled Rejection: ${reason}${colors.reset}`);
  process.exit(1);
});

// Run tests
runAllTests().catch((error) => {
  console.error(`${colors.red}Failed to run tests: ${error.message}${colors.reset}`);
  process.exit(1);
});
