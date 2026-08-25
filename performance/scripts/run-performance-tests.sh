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

# Every stage that produced a failing verdict, in the order it ran. The suite
# may only report success while this list is empty. A breached k6 threshold used
# to be downgraded to a warning and the run still closed on "All k6 tests
# completed", so a regression and a clean run read identically to whoever was
# looking at the output.
FAILED_STAGES=()

# k6 reserves this exit code for "the run finished but at least one threshold was
# crossed", which is a measured regression rather than a suite that could not
# measure at all. Both are failures; the code only decides the wording.
readonly K6_THRESHOLD_BREACH=99

record_failure() {
    FAILED_STAGES+=("$1")
    error "$1"
}

# PIDs of the k6 and tsx stages this run started. Cleanup kills these and nothing
# else. The previous cleanup ran `pkill -f k6`, which matches on command line rather
# than on parentage, so it killed every process on the machine that merely mentioned
# k6 anywhere in its arguments — including the operator's own shell that had invoked
# the suite. A test run must never reach outside the processes it created.
CHILD_PIDS=()

# Terminates only this run's own stages. Stages run one at a time and each is waited
# on before the next starts, so by the time an ordinary run gets here every PID is
# already reaped and every kill fails; that is the expected path, not an error, hence
# the discarded output and the forced success. Killing the stage PID is sufficient
# reach: k6 runs its virtual users as goroutines inside a single process, and the tsx
# launcher forwards termination to the node process it spawns, so neither leaves a
# grandchild behind. Putting the stages in their own process groups to kill the group
# instead would buy nothing here and would cost real behavior — a detached group no
# longer receives the terminal's Ctrl-C directly, so an interactive interrupt would
# get slower rather than cleaner.
kill_own_children() {
    if [[ ${#CHILD_PIDS[@]} -eq 0 ]]; then
        return 0
    fi

    local pid
    for pid in "${CHILD_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done

    CHILD_PIDS=()
    return 0
}

# Runs one TypeScript stage and records its verdict. The existence check is
# separate from the run because a stage pointed at a file that was never written
# fails for a reason no amount of reading the run log explains; naming the path
# says so directly. Output is redirected, so every failure carries its log path
# or the operator gets a verdict with no route to the evidence.
run_tsx_stage() {
    local label="$1"
    local script="$2"
    local log_file="$3"
    shift 3

    if [[ ! -f "$script" ]]; then
        record_failure "${label}: script not found at ${script}"
        return 0
    fi

    # Launched in the background purely so the PID is recordable; the immediate wait
    # keeps the stage sequential exactly as before, and wait returns the stage's own
    # exit status, so the verdict is unchanged.
    tsx "$script" "$@" > "$log_file" 2>&1 &
    local stage_pid=$!
    CHILD_PIDS+=("$stage_pid")

    if wait "$stage_pid"; then
        success "${label} completed"
    else
        record_failure "${label} failed (log: ${log_file})"
    fi
}

# The single exit point for every command path. Stages keep running after a
# failure because the value of a performance sweep is the whole picture: with an
# abort-on-first-breach suite, a second regression stays hidden behind the first
# through a twenty-minute rerun, and the report step consumes the output of every
# stage, so stopping early yields the partial artifact this suite exists to
# avoid. The verdict is therefore decided here, from the recorded results, and
# no caller can close on a summary the results do not support.
finish() {
    local subject="$1"
    local detail="${2:-}"

    if [[ ${#FAILED_STAGES[@]} -eq 0 ]]; then
        success "${subject} completed${detail}"
        exit 0
    fi

    # The failing headline never reuses the word the passing one uses, so a
    # skimmed last line cannot be mistaken for a clean run.
    error "${subject} FAILED${detail} - ${#FAILED_STAGES[@]} stage(s) did not pass:"
    local stage
    for stage in "${FAILED_STAGES[@]}"; do
        echo -e "${RED}   • ${stage}${NC}"
    done
    exit 1
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

# Create the output directories every stage writes into. Separate from
# setup_environment because reporting needs the directories but not a live API.
prepare_output_dirs() {
    mkdir -p "$OUTPUT_DIR"/{k6,database,memory,reports}
    mkdir -p "$OUTPUT_DIR"/baselines
}

# Setup test environment
setup_environment() {
    log "Setting up test environment..."

    prepare_output_dirs

    # Set environment variables for tests
    export BASE_URL
    export TEST_ENV
    export OUTPUT_DIR

    # Check if API is accessible. -f is load-bearing: without it curl exits 0 on
    # any answer at all, so a 404 or a 500 from /health reads as "API is up" and
    # the suite goes on to load-test a server that is not serving.
    if ! curl -fsS "$BASE_URL/health" > /dev/null; then
        error "API is not accessible at $BASE_URL. Please start the API server first."
        exit 1
    fi

    success "Test environment setup completed"
}

# Run k6 load tests
run_k6_tests() {
    log "Running k6 performance tests..."

    # One entry per file in performance/k6/scenarios, matching the scenario list
    # the workflow offers. api-performance was missing here, so the sweep skipped
    # a scenario that exists and is exercised nowhere else in this script.
    local test_scenarios=(
        "api-performance"
        "auth-flow"
        "posting-workflow"
        "analytics-dashboard"
        "provider-integration"
        "user-journey"
    )

    for scenario in "${test_scenarios[@]}"; do
        log "Running k6 test: $scenario"

        local output_file="$OUTPUT_DIR/k6/${scenario}-$(date +%Y%m%d-%H%M%S).json"
        local status=0

        k6 run \
            --out json="$output_file" \
            --env BASE_URL="$BASE_URL" \
            --env TEST_ENV="$TEST_ENV" \
            "$K6_DIR/scenarios/${scenario}.js" &
        local k6_pid=$!
        CHILD_PIDS+=("$k6_pid")
        wait "$k6_pid" || status=$?

        if [[ $status -eq 0 ]]; then
            success "k6 test '$scenario' completed successfully"
        elif [[ $status -eq $K6_THRESHOLD_BREACH ]]; then
            record_failure "k6 '$scenario': thresholds breached"
        else
            record_failure "k6 '$scenario': run did not complete (exit $status)"
        fi

        # Brief pause between tests
        sleep 5
    done
}

# Run database performance tests
run_database_tests() {
    log "Running database performance tests..."

    log "Running PostgreSQL stress test..."
    run_tsx_stage "PostgreSQL stress test" \
        "$PERFORMANCE_DIR/database/postgres-stress.test.ts" \
        "$OUTPUT_DIR/database/postgres-$(date +%Y%m%d-%H%M%S).log"
}

# Run memory leak detection
run_memory_tests() {
    log "Running memory leak detection..."

    run_tsx_stage "Memory leak detection" \
        "$PERFORMANCE_DIR/monitoring/memory-leak-detector.ts" \
        "$OUTPUT_DIR/memory/memory-leak-$(date +%Y%m%d-%H%M%S).log"
}

# Capture performance baseline
capture_baseline() {
    log "Capturing performance baseline..."

    local version="${1:-$(date +%Y%m%d-%H%M%S)}"

    # A missed capture is a failure, not a warning: regression detection compares
    # against the stored baseline, so a run that believes it captured one and did
    # not leaves every later comparison silently anchored to stale numbers.
    run_tsx_stage "Performance baseline capture for version $version" \
        "$PERFORMANCE_DIR/scripts/baseline-capture.ts" \
        "$OUTPUT_DIR/baselines/baseline-capture-$(date +%Y%m%d-%H%M%S).log" \
        "$version" "$TEST_ENV"
}

# Run regression detection
run_regression_detection() {
    log "Running performance regression detection..."

    local current_version="${1:-current}"

    # The detector exits non-zero both when it cannot run and when it finds a
    # regression. Downgrading that to a warning turned the one stage whose entire
    # job is to say "this got slower" into a stage that cannot say it.
    run_tsx_stage "Regression detection" \
        "$PERFORMANCE_DIR/monitoring/regression-detector.ts" \
        "$OUTPUT_DIR/reports/regression-$(date +%Y%m%d-%H%M%S).log" \
        "$current_version" "$TEST_ENV"
}

# Generate comprehensive report
generate_report() {
    log "Generating comprehensive performance report..."

    # The report is the observable output of the whole suite, so a report that
    # could not be produced is a real loss and must not read as a completed run.
    run_tsx_stage "Comprehensive report generation" \
        "$PERFORMANCE_DIR/scripts/generate-reports.ts" \
        "$OUTPUT_DIR/reports/comprehensive-$(date +%Y%m%d-%H%M%S).log" \
        "$OUTPUT_DIR"
}

# Cleanup after tests
cleanup() {
    log "Cleaning up test environment..."

    kill_own_children

    # Clean up temporary files older than 7 days
    find "$OUTPUT_DIR" -name "*.tmp" -mtime +7 -delete 2>/dev/null || true

    success "Cleanup completed"
}

# Reclaim a still-running stage on every exit path, not just the one that reaches the
# end of the suite: a failed precondition, an aborted stage, an interrupt, or a CI
# cancellation all used to leave whatever was running behind. The handler stays silent
# so the verdict that finish() prints remains the last line an operator reads. INT and
# TERM exit rather than clean up directly, so both funnel through the single EXIT
# handler and report the conventional signal status.
trap kill_own_children EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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

    log "Results available in: $OUTPUT_DIR"
    finish "Performance test suite" " in ${duration} seconds"
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
        finish "k6 load tests"
        ;;
    "database")
        check_dependencies
        setup_environment
        run_database_tests
        finish "Database performance tests"
        ;;
    "memory")
        check_dependencies
        setup_environment
        run_memory_tests
        finish "Memory tests"
        ;;
    "baseline")
        check_dependencies
        setup_environment
        capture_baseline "${VERSION:-}"
        finish "Baseline capture"
        ;;
    "regression")
        check_dependencies
        setup_environment
        run_regression_detection "${VERSION:-}"
        finish "Regression detection"
        ;;
    "report")
        check_dependencies
        # Only the directories, not the full setup: reporting reads output files
        # already on disk, so gating it on a live API would make it unusable for
        # the case it exists to serve. Without this the report writes into a
        # directory that may not exist and fails for a reason unrelated to it.
        prepare_output_dirs
        generate_report
        finish "Report generation"
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