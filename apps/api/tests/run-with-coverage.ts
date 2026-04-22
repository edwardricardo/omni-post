// Enhanced test runner with coverage reporting capabilities
// This runner supports both regular test execution and coverage analysis

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const GLOBAL_TIMEOUT = 45000; // 45 seconds for coverage runs (longer timeout)
const TEST_TIMEOUT = 15000; // 15 seconds per test for coverage
const COVERAGE_MODE = process.env.COVERAGE_MODE === "true";

interface TestModule {
  name: string;
  path: string;
  enabled: boolean;
  category: "core" | "threading" | "security" | "infrastructure" | "integration";
}

const TEST_MODULES: TestModule[] = [
  // Core API Tests
  { name: "Plan Publication", path: "./planPublication.test.ts", enabled: true, category: "core" },
  { name: "Adapters", path: "./adapters.test.ts", enabled: true, category: "core" },
  { name: "Media Flow", path: "./media.flow.test.ts", enabled: true, category: "core" },
  { name: "Schedule Flow", path: "./schedule.flow.test.ts", enabled: true, category: "core" },
  { name: "Analytics Flow", path: "./analytics.flow.test.ts", enabled: true, category: "core" },
  { name: "Rate Limit Smoke", path: "./rateLimit.smoke.test.ts", enabled: true, category: "core" },

  // Threading Tests
  {
    name: "Threading Planner",
    path: "./threading.planner.test.ts",
    enabled: true,
    category: "threading",
  },
  {
    name: "Threading X Provider",
    path: "./threading.xprovider.test.ts",
    enabled: true,
    category: "threading",
  },
  {
    name: "Threading Flow",
    path: "./threading.flow.test.ts",
    enabled: true,
    category: "threading",
  },

  // Multi-Project Tests
  {
    name: "Multi-Project Flow",
    path: "./multiproject.flow.test.ts",
    enabled: true,
    category: "core",
  },

  // Security & Auth Tests
  { name: "Security", path: "./security.test.ts", enabled: true, category: "security" },
  { name: "Authentication", path: "./auth.test.ts", enabled: true, category: "security" },
  { name: "MFA", path: "./mfa.test.ts", enabled: true, category: "security" },
  { name: "RBAC", path: "./rbac.test.ts", enabled: true, category: "security" },

  // Account Management Tests
  {
    name: "Account Lifecycle",
    path: "./accountLifecycle.test.ts",
    enabled: true,
    category: "infrastructure",
  },
  {
    name: "Trial Period",
    path: "./trialPeriod.test.ts",
    enabled: true,
    category: "infrastructure",
  },

  // Infrastructure Tests
  { name: "Audit", path: "./audit.test.ts", enabled: true, category: "infrastructure" },
  {
    name: "Schema Utils",
    path: "./schemaUtils.test.ts",
    enabled: true,
    category: "infrastructure",
  },
  {
    name: "Provider Registry",
    path: "./providerRegistry.test.ts",
    enabled: true,
    category: "infrastructure",
  },

  // Integration Tests
  {
    name: "Universal Client Dashboard Integration",
    path: "./universal-client-dashboard.integration.test.ts",
    enabled: true,
    category: "integration",
  },
];

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
  category: string;
}

interface _CoverageStats {
  lines: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
}

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

// Track global state
let testResults: TestResult[] = [];
let startTime = Date.now();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getCoverageThresholds() {
  return {
    lines: 90,
    functions: 90,
    branches: 85,
    statements: 90,
  };
}

function formatCoveragePercentage(pct: number, threshold: number): string {
  const colorCode =
    pct >= threshold ? colors.green : pct >= threshold - 10 ? colors.yellow : colors.red;
  return `${colorCode}${pct.toFixed(1)}%${colors.reset}`;
}

async function runSingleTest(testModule: TestModule): Promise<TestResult> {
  const testStartTime = Date.now();

  try {
    if (COVERAGE_MODE) {
      console.log(
        `${colors.cyan}▶ Running ${testModule.name} [${testModule.category}]...${colors.reset}`
      );
    } else {
      console.log(`${colors.blue}▶ Running ${testModule.name}...${colors.reset}`);
    }

    // Dynamic import with timeout
    const modulePromise = import(testModule.path);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Test timeout after ${TEST_TIMEOUT}ms`)), TEST_TIMEOUT);
    });

    await Promise.race([modulePromise, timeoutPromise]);

    const duration = Date.now() - testStartTime;
    console.log(
      `${colors.green}✓ ${testModule.name} passed (${formatDuration(duration)})${colors.reset}`
    );

    return {
      name: testModule.name,
      success: true,
      duration,
      category: testModule.category,
    };
  } catch (error) {
    const duration = Date.now() - testStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(
      `${colors.red}✗ ${testModule.name} failed (${formatDuration(duration)})${colors.reset}`
    );
    console.log(`${colors.red}  Error: ${errorMessage}${colors.reset}`);

    return {
      name: testModule.name,
      success: false,
      duration,
      error: errorMessage,
      category: testModule.category,
    };
  }
}

function printCategorySummary() {
  const categories = ["core", "threading", "security", "infrastructure", "integration"];

  console.log(`\n${colors.bold}📋 Test Results by Category${colors.reset}`);

  categories.forEach((category) => {
    const categoryTests = testResults.filter((t) => t.category === category);
    if (categoryTests.length === 0) return;

    const passed = categoryTests.filter((t) => t.success).length;
    const total = categoryTests.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    const statusColor =
      passed === total ? colors.green : passed > total * 0.8 ? colors.yellow : colors.red;
    const categoryIcon =
      {
        core: "🔧",
        threading: "🧵",
        security: "🔒",
        infrastructure: "🏗️",
        integration: "🔗",
      }[category] || "📦";

    console.log(
      `${categoryIcon} ${category.padEnd(15)} ${statusColor}${passed}/${total} (${percentage}%)${colors.reset}`
    );
  });
}

async function displayCoverageReport() {
  if (!COVERAGE_MODE) return;

  try {
    const fs = await import("fs");
    const coverageJsonPath = join(__dirname, "../coverage/coverage-final.json");

    if (!fs.existsSync(coverageJsonPath)) {
      console.log(
        `${colors.yellow}⚠ No coverage data found. Run tests with coverage first.${colors.reset}`
      );
      return;
    }

    const coverageData = JSON.parse(fs.readFileSync(coverageJsonPath, "utf8"));
    const thresholds = getCoverageThresholds();

    // Calculate overall coverage
    let totalLines = 0,
      coveredLines = 0;
    let totalFunctions = 0,
      coveredFunctions = 0;
    let totalStatements = 0,
      coveredStatements = 0;
    let totalBranches = 0,
      coveredBranches = 0;

    Object.values(coverageData).forEach((fileCoverage: any) => {
      // Lines
      totalLines += Object.keys(fileCoverage.s).length;
      coveredLines += Object.values(fileCoverage.s).filter((count: any) => count > 0).length;

      // Functions
      totalFunctions += Object.keys(fileCoverage.f).length;
      coveredFunctions += Object.values(fileCoverage.f).filter((count: any) => count > 0).length;

      // Statements
      totalStatements += Object.keys(fileCoverage.s).length;
      coveredStatements += Object.values(fileCoverage.s).filter((count: any) => count > 0).length;

      // Branches
      totalBranches += Object.keys(fileCoverage.b).length * 2; // Each branch has 2 paths
      Object.values(fileCoverage.b).forEach((branchCoverage: any) => {
        coveredBranches += branchCoverage.filter((count: any) => count > 0).length;
      });
    });

    const linesPct = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
    const functionsPct = totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0;
    const statementsPct = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;
    const branchesPct = totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;

    console.log(`\n${colors.bold}${colors.cyan}📊 Coverage Report${colors.reset}`);
    console.log(`${colors.dim}${"".padEnd(50, "─")}${colors.reset}`);
    console.log(
      `Lines:      ${formatCoveragePercentage(linesPct, thresholds.lines).padEnd(20)} ${coveredLines}/${totalLines}`
    );
    console.log(
      `Functions:  ${formatCoveragePercentage(functionsPct, thresholds.functions).padEnd(20)} ${coveredFunctions}/${totalFunctions}`
    );
    console.log(
      `Statements: ${formatCoveragePercentage(statementsPct, thresholds.statements).padEnd(20)} ${coveredStatements}/${totalStatements}`
    );
    console.log(
      `Branches:   ${formatCoveragePercentage(branchesPct, thresholds.branches).padEnd(20)} ${coveredBranches}/${totalBranches}`
    );

    const overallScore = (linesPct + functionsPct + statementsPct + branchesPct) / 4;
    console.log(`${colors.dim}${"".padEnd(50, "─")}${colors.reset}`);
    console.log(`Overall:    ${formatCoveragePercentage(overallScore, 85)}`);

    // Coverage status
    const allThresholdsMet =
      linesPct >= thresholds.lines &&
      functionsPct >= thresholds.functions &&
      statementsPct >= thresholds.statements &&
      branchesPct >= thresholds.branches;

    if (allThresholdsMet) {
      console.log(`\n${colors.green}🎯 All coverage thresholds met!${colors.reset}`);
    } else {
      console.log(`\n${colors.yellow}⚠ Some coverage thresholds not met${colors.reset}`);
      console.log(
        `${colors.dim}Target: Lines ${thresholds.lines}%, Functions ${thresholds.functions}%, Statements ${thresholds.statements}%, Branches ${thresholds.branches}%${colors.reset}`
      );
    }
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to read coverage report: ${error instanceof Error ? error.message : String(error)}${colors.reset}`
    );
  }
}

async function runAllTests(): Promise<void> {
  const mode = COVERAGE_MODE ? "Coverage Analysis" : "Test Suite";
  console.log(`${colors.bold}${colors.blue}🧪 Running ${mode}${colors.reset}`);
  console.log(`${colors.blue}Found ${TEST_MODULES.length} test modules${colors.reset}`);

  if (COVERAGE_MODE) {
    console.log(
      `${colors.cyan}📊 Coverage reporting enabled - generating detailed metrics${colors.reset}`
    );
  }
  console.log();

  const enabledTests = TEST_MODULES.filter((test) => test.enabled);

  for (const testModule of enabledTests) {
    const result = await runSingleTest(testModule);
    testResults.push(result);

    // Small delay between tests for coverage processing
    await new Promise((resolve) => setTimeout(resolve, COVERAGE_MODE ? 200 : 100));
  }

  // Print summary
  const totalDuration = Date.now() - startTime;
  const passed = testResults.filter((r) => r.success).length;
  const failed = testResults.filter((r) => !r.success).length;
  const successRate = ((passed / testResults.length) * 100).toFixed(1);

  console.log(`\n${colors.bold}📊 Test Summary${colors.reset}`);
  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);
  console.log(`${colors.blue}⏱ Total Duration: ${formatDuration(totalDuration)}${colors.reset}`);
  console.log(`${colors.magenta}📈 Success Rate: ${successRate}%${colors.reset}`);

  // Category breakdown
  printCategorySummary();

  // Coverage report
  await displayCoverageReport();

  if (failed > 0) {
    console.log(`\n${colors.red}❌ Failed Tests:${colors.reset}`);
    testResults
      .filter((r) => !r.success)
      .forEach((result) => {
        console.log(`${colors.red}  • ${result.name}: ${result.error}${colors.reset}`);
      });

    if (COVERAGE_MODE) {
      console.log(
        `\n${colors.yellow}⚠ Coverage report may be incomplete due to test failures${colors.reset}`
      );
    }

    process.exit(1);
  } else {
    console.log(`\n${colors.green}🎉 All tests passed!${colors.reset}`);

    if (COVERAGE_MODE) {
      console.log(
        `${colors.cyan}📄 Detailed coverage reports generated in ./coverage/${colors.reset}`
      );
      console.log(
        `${colors.cyan}🌐 Open ./coverage/index.html for interactive coverage report${colors.reset}`
      );
    }

    process.exit(0);
  }
}

// Handle global timeout
setTimeout(() => {
  console.log(
    `${colors.red}❌ Global timeout reached (${formatDuration(GLOBAL_TIMEOUT)})${colors.reset}`
  );
  if (COVERAGE_MODE) {
    console.log(`${colors.yellow}⚠ Coverage data may be incomplete due to timeout${colors.reset}`);
  }
  process.exit(1);
}, GLOBAL_TIMEOUT);

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error(`${colors.red}Uncaught Exception: ${error.message}${colors.reset}`);
  if (COVERAGE_MODE) {
    console.error(
      `${colors.yellow}⚠ Coverage data may be incomplete due to uncaught exception${colors.reset}`
    );
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`${colors.red}Unhandled Rejection: ${reason}${colors.reset}`);
  if (COVERAGE_MODE) {
    console.error(
      `${colors.yellow}⚠ Coverage data may be incomplete due to unhandled rejection${colors.reset}`
    );
  }
  process.exit(1);
});

// Run tests
runAllTests().catch((error) => {
  console.error(`${colors.red}Failed to run tests: ${error.message}${colors.reset}`);
  process.exit(1);
});
