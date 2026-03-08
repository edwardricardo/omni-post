#!/bin/bash

# Performance Testing Orchestration Script
# Runs comprehensive performance tests for the social media CMS platform

set -e

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_ENV="${TEST_ENV:-development}"
OUTPUT_DIR="${OUTPUT_DIR:-./performance/reports}"
K6_DIR="./performance/k6"
PERFORMANCE_DIR="./performance"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if required tools are installed
check_dependencies() {
    log "Checking dependencies..."

    # Check if k6 is installed
    if ! command -v k6 &> /dev/null; then
        error "k6 is not installed. Please install k6 from https://k6.io/docs/getting-started/installation/"
        exit 1
    fi

    # Check if Node.js is available for TypeScript tests
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js"
        exit 1
    fi

    # Check if tsx is available for TypeScript execution
    if ! command -v tsx &> /dev/null; then
        error "tsx is not installed. Please run: npm install -g tsx"
        exit 1
    fi

    success "All dependencies are available"
}

# Setup test environment
setup_environment() {
    log "Setting up test environment..."

    # Create output directories
    mkdir -p "$OUTPUT_DIR"/{k6,database,memory,reports}
    mkdir -p "$OUTPUT_DIR"/baselines

    # Set environment variables for tests
    export BASE_URL
    export TEST_ENV
    export OUTPUT_DIR

    # Check if API is accessible
    if ! curl -s "$BASE_URL/health" > /dev/null; then
        error "API is not accessible at $BASE_URL. Please start the API server first."
        exit 1
    fi

    success "Test environment setup completed"
}

# Run k6 load tests
run_k6_tests() {
    log "Running k6 performance tests..."

    local test_scenarios=(
        "auth-flow"
        "posting-workflow"
        "analytics-dashboard"
        "provider-integration"
        "user-journey"
    )

    for scenario in "${test_scenarios[@]}"; do
        log "Running k6 test: $scenario"

        local output_file="$OUTPUT_DIR/k6/${scenario}-$(date +%Y%m%d-%H%M%S).json"

        if k6 run \
            --out json="$output_file" \
            --env BASE_URL="$BASE_URL" \
            --env TEST_ENV="$TEST_ENV" \
            "$K6_DIR/scenarios/${scenario}.js"; then
            success "k6 test '$scenario' completed successfully"
        else
            warning "k6 test '$scenario' failed or had warnings"
        fi

        # Brief pause between tests
        sleep 5
    done

    success "All k6 tests completed"
}

# Run database performance tests
run_database_tests() {
    log "Running database performance tests..."

    log "Running PostgreSQL stress test..."
    if tsx "$PERFORMANCE_DIR/database/postgres-stress.test.ts" > "$OUTPUT_DIR/database/postgres-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "PostgreSQL stress test completed"
    else
        warning "PostgreSQL stress test failed or had warnings"
    fi

    log "Running Redis performance test..."
    if tsx "$PERFORMANCE_DIR/database/redis-performance.test.ts" > "$OUTPUT_DIR/database/redis-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "Redis performance test completed"
    else
        warning "Redis performance test failed or had warnings"
    fi

    success "Database performance tests completed"
}

# Run memory leak detection
run_memory_tests() {
    log "Running memory leak detection..."

    if tsx "$PERFORMANCE_DIR/monitoring/memory-leak-detector.ts" > "$OUTPUT_DIR/memory/memory-leak-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "Memory leak detection completed"
    else
        warning "Memory leak detection failed or had warnings"
    fi

    success "Memory tests completed"
}

# Capture performance baseline
capture_baseline() {
    log "Capturing performance baseline..."

    local version="${1:-$(date +%Y%m%d-%H%M%S)}"

    if tsx "$PERFORMANCE_DIR/scripts/baseline-capture.ts" "$version" "$TEST_ENV" > "$OUTPUT_DIR/baselines/baseline-capture-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "Performance baseline captured for version $version"
    else
        warning "Baseline capture failed or had warnings"
    fi
}

# Run regression detection
run_regression_detection() {
    log "Running performance regression detection..."

    local current_version="${1:-current}"

    if tsx "$PERFORMANCE_DIR/monitoring/regression-detector.ts" "$current_version" "$TEST_ENV" > "$OUTPUT_DIR/reports/regression-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "Regression detection completed"
    else
        warning "Regression detection failed or had warnings"
    fi
}

# Generate comprehensive report
generate_report() {
    log "Generating comprehensive performance report..."

    if tsx "$PERFORMANCE_DIR/scripts/generate-reports.ts" "$OUTPUT_DIR" > "$OUTPUT_DIR/reports/comprehensive-$(date +%Y%m%d-%H%M%S).log" 2>&1; then
        success "Comprehensive report generated"
    else
        warning "Report generation failed or had warnings"
    fi
}

# Cleanup after tests
cleanup() {
    log "Cleaning up test environment..."

    # Kill any background processes
    pkill -f "k6" || true
    pkill -f "tsx.*performance" || true

    # Clean up temporary files older than 7 days
    find "$OUTPUT_DIR" -name "*.tmp" -mtime +7 -delete 2>/dev/null || true

    success "Cleanup completed"
}

# Main test execution function
run_all_tests() {
    local start_time=$(date +%s)

    log "Starting comprehensive performance test suite..."
    log "Base URL: $BASE_URL"
    log "Environment: $TEST_ENV"
    log "Output Directory: $OUTPUT_DIR"

    # Setup
    check_dependencies
    setup_environment

    # Capture baseline if requested
    if [[ "${CAPTURE_BASELINE:-false}" == "true" ]]; then
        capture_baseline "${VERSION:-}"
    fi

    # Run test suites
    if [[ "${SKIP_K6:-false}" != "true" ]]; then
        run_k6_tests
    fi

    if [[ "${SKIP_DATABASE:-false}" != "true" ]]; then
        run_database_tests
    fi

    if [[ "${SKIP_MEMORY:-false}" != "true" ]]; then
        run_memory_tests
    fi

    # Run regression detection if baseline exists
    if [[ "${RUN_REGRESSION:-false}" == "true" ]]; then
        run_regression_detection "${VERSION:-}"
    fi

    # Generate comprehensive report
    if [[ "${SKIP_REPORT:-false}" != "true" ]]; then
        generate_report
    fi

    # Cleanup
    cleanup

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    success "Performance test suite completed in ${duration} seconds"
    log "Results available in: $OUTPUT_DIR"
}

# Help function
show_help() {
    cat << EOF
Performance Testing Script

Usage: $0 [options] [command]

Commands:
    all              Run all performance tests (default)
    k6               Run only k6 load tests
    database         Run only database performance tests
    memory           Run only memory leak detection
    baseline         Capture performance baseline
    regression       Run regression detection
    report           Generate comprehensive report
    help             Show this help message

Environment Variables:
    BASE_URL         API base URL (default: http://localhost:3000)
    TEST_ENV         Test environment (default: development)
    OUTPUT_DIR       Output directory for reports (default: ./performance/reports)
    VERSION          Version identifier for baseline/regression
    CAPTURE_BASELINE Set to 'true' to capture baseline before tests
    RUN_REGRESSION   Set to 'true' to run regression detection after tests
    SKIP_K6          Set to 'true' to skip k6 tests
    SKIP_DATABASE    Set to 'true' to skip database tests
    SKIP_MEMORY      Set to 'true' to skip memory tests
    SKIP_REPORT      Set to 'true' to skip report generation

Examples:
    # Run all tests
    $0

    # Run all tests with baseline capture
    CAPTURE_BASELINE=true VERSION=v1.2.0 $0

    # Run only k6 tests against staging
    BASE_URL=https://staging.api.example.com TEST_ENV=staging $0 k6

    # Run tests with regression detection
    RUN_REGRESSION=true VERSION=v1.2.0 $0

    # Skip memory tests and report generation
    SKIP_MEMORY=true SKIP_REPORT=true $0
EOF
}

# Parse command line arguments
case "${1:-all}" in
    "all")
        run_all_tests
        ;;
    "k6")
        check_dependencies
        setup_environment
        run_k6_tests
        ;;
    "database")
        check_dependencies
        setup_environment
        run_database_tests
        ;;
    "memory")
        check_dependencies
        setup_environment
        run_memory_tests
        ;;
    "baseline")
        check_dependencies
        setup_environment
        capture_baseline "${VERSION:-}"
        ;;
    "regression")
        check_dependencies
        setup_environment
        run_regression_detection "${VERSION:-}"
        ;;
    "report")
        check_dependencies
        generate_report
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac