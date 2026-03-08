#!/bin/bash

# Comprehensive Quality Checks Script
# Runs all quality validation checks with detailed reporting

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORTS_DIR="$PROJECT_ROOT/quality/reports"
PROFILE="${1:-standard}"
ENVIRONMENT="${2:-development}"

# Logging functions
log_header() {
    echo -e "\n${PURPLE}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}  $1${NC}"
    echo -e "${PURPLE}═══════════════════════════════════════════════════════════════════════════════${NC}\n"
}

log_section() {
    echo -e "\n${CYAN}▶ $1${NC}"
    echo -e "${CYAN}$(printf '─%.0s' {1..80})${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Create reports directory structure
setup_reports_dir() {
    mkdir -p "$REPORTS_DIR"/{security,code-quality,tests,performance,final}
}

# TypeScript compilation check
check_typescript() {
    log_section "TypeScript Compilation"

    local report_file="$REPORTS_DIR/code-quality/typescript-report.json"
    local errors=0

    # Create compilation report
    {
        echo "{"
        echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
        echo "  \"command\": \"tsc --noEmit\","
    } > "$report_file"

    if npx tsc --noEmit 2>"$REPORTS_DIR/code-quality/typescript-errors.txt"; then
        log_success "TypeScript compilation successful"
        echo "  \"status\": \"success\"," >> "$report_file"
        echo "  \"errors\": 0" >> "$report_file"
    else
        errors=$(wc -l < "$REPORTS_DIR/code-quality/typescript-errors.txt" 2>/dev/null || echo 0)
        log_error "TypeScript compilation failed with $errors errors"
        echo "  \"status\": \"failed\"," >> "$report_file"
        echo "  \"errors\": $errors" >> "$report_file"
    fi

    echo "}" >> "$report_file"
    return $errors
}

# ESLint analysis
run_eslint() {
    log_section "ESLint Analysis"

    local report_file="$REPORTS_DIR/code-quality/eslint-report.json"

    log_info "Running ESLint with comprehensive rules..."

    # Run ESLint with JSON output
    if npx eslint . --ext .ts,.tsx,.js,.jsx --format json --output-file "$report_file"; then
        local errors warnings
        errors=$(jq '[.[] | .messages[] | select(.severity == 2)] | length' "$report_file" 2>/dev/null || echo 0)
        warnings=$(jq '[.[] | .messages[] | select(.severity == 1)] | length' "$report_file" 2>/dev/null || echo 0)

        if [ "$errors" -eq 0 ] && [ "$warnings" -eq 0 ]; then
            log_success "ESLint passed with no issues"
        elif [ "$errors" -eq 0 ]; then
            log_warning "ESLint passed with $warnings warnings"
        else
            log_error "ESLint failed with $errors errors and $warnings warnings"
        fi

        return $errors
    else
        log_error "ESLint execution failed"
        return 1
    fi
}

# Prettier formatting check
check_prettier() {
    log_section "Code Formatting"

    local report_file="$REPORTS_DIR/code-quality/prettier-report.txt"

    log_info "Checking code formatting with Prettier..."

    if npx prettier --check . --list-different > "$report_file" 2>&1; then
        log_success "All files are properly formatted"
        return 0
    else
        local violations
        violations=$(wc -l < "$report_file" 2>/dev/null || echo 0)
        log_error "Found $violations formatting violations"
        log_info "Run 'pnpm format' to fix formatting issues"
        return $violations
    fi
}

# Security scanning
run_security_scan() {
    log_section "Security Scanning"

    local security_dir="$REPORTS_DIR/security"

    # Dependency audit
    log_info "Running dependency vulnerability audit..."
    if pnpm audit --audit-level moderate --json > "$security_dir/pnpm-audit.json" 2>/dev/null; then
        log_success "Dependency audit completed"
    else
        log_warning "Dependency audit found vulnerabilities"
    fi

    # Secret detection with git-secrets (if available)
    if command_exists git-secrets; then
        log_info "Scanning for secrets..."
        if git secrets --scan; then
            log_success "No secrets detected"
        else
            log_error "Potential secrets detected"
        fi
    fi

    # License compliance check
    log_info "Checking license compliance..."
    if command_exists license-checker; then
        npx license-checker --json --out "$security_dir/licenses.json"
        log_success "License compliance check completed"
    else
        log_warning "License checker not available"
    fi

    return 0
}

# Test execution
run_tests() {
    log_section "Test Execution"

    local test_dir="$REPORTS_DIR/tests"
    local total_failures=0

    # Unit tests
    log_info "Running unit tests..."
    if pnpm --filter @apps/api test:unit --coverage --coverage-directory="$test_dir/unit-coverage" 2>/dev/null; then
        log_success "Unit tests passed"
    else
        log_error "Unit tests failed"
        total_failures=$((total_failures + 1))
    fi

    # Integration tests (if dependencies are running)
    if docker compose ps | grep -q "postgres.*Up" && docker compose ps | grep -q "redis.*Up"; then
        log_info "Running integration tests..."
        if pnpm --filter @apps/api test:integration --coverage --coverage-directory="$test_dir/integration-coverage" 2>/dev/null; then
            log_success "Integration tests passed"
        else
            log_error "Integration tests failed"
            total_failures=$((total_failures + 1))
        fi
    else
        log_warning "Skipping integration tests - dependencies not running"
    fi

    return $total_failures
}

# Performance testing
run_performance_tests() {
    log_section "Performance Testing"

    local perf_dir="$REPORTS_DIR/performance"

    # Check if API is running
    if curl -f http://localhost:3000/health >/dev/null 2>&1; then
        log_info "Running basic performance tests..."

        # Simple load test with autocannon (if available)
        if command_exists autocannon; then
            log_info "Running load test with autocannon..."
            autocannon -c 10 -d 30 -j http://localhost:3000/health > "$perf_dir/load-test.json" 2>/dev/null || true
            log_success "Load test completed"
        fi

        # Memory usage test
        log_info "Checking memory usage..."
        ps aux | grep -E "(node|npm|pnpm)" | grep -v grep > "$perf_dir/memory-usage.txt" || true
    else
        log_warning "API not running - skipping performance tests"
        log_info "Start API with 'pnpm dev:api' to run performance tests"
    fi

    return 0
}

# Bundle analysis
analyze_bundle() {
    log_section "Bundle Analysis"

    local analysis_dir="$REPORTS_DIR/code-quality"

    log_info "Analyzing bundle size and dependencies..."

    # Dependency analysis
    if command_exists depcheck; then
        npx depcheck --json > "$analysis_dir/depcheck.json" 2>/dev/null || true
        log_success "Dependency analysis completed"
    fi

    # Package size analysis
    if command_exists bundlesize; then
        npx bundlesize > "$analysis_dir/bundle-size.txt" 2>/dev/null || true
    fi

    # Create bundle report
    {
        echo "{"
        echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
        echo "  \"node_modules_size\": \"$(du -sh node_modules 2>/dev/null | cut -f1 || echo 'unknown')\","
        echo "  \"package_count\": $(find node_modules -name package.json | wc -l 2>/dev/null || echo 0)
        echo "}"
    } > "$analysis_dir/bundle-analysis.json"

    return 0
}

# Code complexity analysis
analyze_complexity() {
    log_section "Code Complexity Analysis"

    local complexity_dir="$REPORTS_DIR/code-quality"

    log_info "Analyzing code complexity..."

    # TypeScript complexity analysis (if tools are available)
    if command_exists ts-node; then
        # Create a simple complexity analyzer
        cat > "/tmp/complexity-analyzer.ts" << 'EOF'
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

interface ComplexityResult {
  file: string;
  complexity: number;
  lines: number;
}

const analyzeFile = (filePath: string): ComplexityResult => {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').length;

  // Simple complexity calculation based on keywords
  const complexityKeywords = [
    'if', 'else', 'for', 'while', 'switch', 'case',
    'catch', 'try', 'function', 'class', '&&', '||'
  ];

  let complexity = 1; // Base complexity

  complexityKeywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    const matches = content.match(regex) || [];
    complexity += matches.length;
  });

  return { file: filePath, complexity, lines };
};

const main = () => {
  const files = glob.sync('**/*.{ts,tsx}', {
    ignore: ['node_modules/**', 'dist/**', '**/*.d.ts']
  });

  const results = files.map(analyzeFile);
  const totalComplexity = results.reduce((sum, r) => sum + r.complexity, 0);
  const avgComplexity = totalComplexity / results.length;

  const report = {
    timestamp: new Date().toISOString(),
    total_files: results.length,
    total_complexity: totalComplexity,
    average_complexity: avgComplexity,
    high_complexity_files: results.filter(r => r.complexity > 15),
    files: results
  };

  writeFileSync('quality/reports/code-quality/complexity.json', JSON.stringify(report, null, 2));
  console.log(`Analyzed ${results.length} files, average complexity: ${avgComplexity.toFixed(2)}`);
};

main();
EOF

        if npx tsx /tmp/complexity-analyzer.ts 2>/dev/null; then
            log_success "Complexity analysis completed"
        else
            log_warning "Complexity analysis failed"
        fi

        rm -f /tmp/complexity-analyzer.ts
    else
        log_warning "TypeScript tools not available for complexity analysis"
    fi

    return 0
}

# Generate final report
generate_final_report() {
    log_section "Generating Final Report"

    local final_report="$REPORTS_DIR/final/quality-summary.json"

    log_info "Generating comprehensive quality report..."

    # Collect all metrics
    local typescript_errors=0
    local eslint_errors=0
    local eslint_warnings=0
    local prettier_violations=0
    local security_issues=0

    # Parse TypeScript report
    if [ -f "$REPORTS_DIR/code-quality/typescript-report.json" ]; then
        typescript_errors=$(jq -r '.errors' "$REPORTS_DIR/code-quality/typescript-report.json" 2>/dev/null || echo 0)
    fi

    # Parse ESLint report
    if [ -f "$REPORTS_DIR/code-quality/eslint-report.json" ]; then
        eslint_errors=$(jq '[.[] | .messages[] | select(.severity == 2)] | length' "$REPORTS_DIR/code-quality/eslint-report.json" 2>/dev/null || echo 0)
        eslint_warnings=$(jq '[.[] | .messages[] | select(.severity == 1)] | length' "$REPORTS_DIR/code-quality/eslint-report.json" 2>/dev/null || echo 0)
    fi

    # Parse Prettier report
    if [ -f "$REPORTS_DIR/code-quality/prettier-report.txt" ]; then
        prettier_violations=$(wc -l < "$REPORTS_DIR/code-quality/prettier-report.txt" 2>/dev/null || echo 0)
    fi

    # Calculate overall score
    local score=100
    score=$((score - typescript_errors * 10))
    score=$((score - eslint_errors * 5))
    score=$((score - eslint_warnings * 1))
    score=$((score - prettier_violations * 2))

    if [ $score -lt 0 ]; then score=0; fi

    # Generate report
    cat > "$final_report" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "profile": "$PROFILE",
  "environment": "$ENVIRONMENT",
  "overall_score": $score,
  "status": "$([ $score -ge 80 ] && echo "PASSED" || echo "FAILED")",
  "metrics": {
    "code_quality": {
      "typescript_errors": $typescript_errors,
      "eslint_errors": $eslint_errors,
      "eslint_warnings": $eslint_warnings,
      "prettier_violations": $prettier_violations
    },
    "security": {
      "issues_found": $security_issues
    }
  },
  "reports_generated": [
    "typescript-report.json",
    "eslint-report.json",
    "prettier-report.txt",
    "complexity.json",
    "bundle-analysis.json"
  ]
}
EOF

    log_success "Final report generated: $final_report"

    # Display summary
    echo
    log_header "QUALITY CHECK SUMMARY"
    echo -e "${BLUE}Profile:${NC} $PROFILE"
    echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
    echo -e "${BLUE}Overall Score:${NC} $score/100"
    echo -e "${BLUE}Status:${NC} $([ $score -ge 80 ] && echo -e "${GREEN}PASSED${NC}" || echo -e "${RED}FAILED${NC}")"
    echo
    echo -e "${BLUE}Code Quality Issues:${NC}"
    echo -e "  TypeScript Errors: $typescript_errors"
    echo -e "  ESLint Errors: $eslint_errors"
    echo -e "  ESLint Warnings: $eslint_warnings"
    echo -e "  Formatting Issues: $prettier_violations"
    echo

    return $([ $score -ge 80 ] && echo 0 || echo 1)
}

# Main execution
main() {
    cd "$PROJECT_ROOT"

    log_header "COMPREHENSIVE QUALITY CHECKS"
    echo -e "${BLUE}Profile:${NC} $PROFILE"
    echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
    echo -e "${BLUE}Project Root:${NC} $PROJECT_ROOT"

    # Setup
    setup_reports_dir

    # Run all checks
    local total_failures=0

    check_typescript || total_failures=$((total_failures + 1))
    run_eslint || total_failures=$((total_failures + 1))
    check_prettier || total_failures=$((total_failures + 1))
    run_security_scan || total_failures=$((total_failures + 1))
    run_tests || total_failures=$((total_failures + 1))
    run_performance_tests || total_failures=$((total_failures + 1))
    analyze_bundle || total_failures=$((total_failures + 1))
    analyze_complexity || total_failures=$((total_failures + 1))

    # Generate final report
    if generate_final_report; then
        log_success "Quality checks completed successfully!"
        exit 0
    else
        log_error "Quality checks failed!"
        exit 1
    fi
}

# Handle script interruption
trap 'log_error "Quality checks interrupted"; exit 1' INT TERM

# Run main function
main "$@"