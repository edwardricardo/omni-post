#!/bin/bash

# Comprehensive Security Scanning Script
# Automated security testing for the Social Media CMS platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECURITY_DIR="${PROJECT_ROOT}/security"
REPORTS_DIR="${SECURITY_DIR}/reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCAN_REPORT="${REPORTS_DIR}/security_scan_${TIMESTAMP}.html"

# Default values
SCAN_TYPE="comprehensive"
SEVERITY_THRESHOLD="high"
API_URL="http://localhost:3000"
VERBOSE=false
FAIL_ON_FINDINGS=true

# Help function
show_help() {
    cat << EOF
Security Scanning Script for Social Media CMS

Usage: $0 [OPTIONS]

OPTIONS:
    -t, --type TYPE              Scan type: comprehensive, sast, dast, deps (default: comprehensive)
    -s, --severity LEVEL         Severity threshold: critical, high, medium, low (default: high)
    -u, --url URL               API URL for DAST scanning (default: http://localhost:3000)
    -v, --verbose               Enable verbose output
    -c, --continue-on-fail      Continue execution even if vulnerabilities are found
    -o, --output FILE           Output report file (default: auto-generated)
    -h, --help                  Show this help message

SCAN TYPES:
    comprehensive               Run all security scans (SAST, DAST, dependency, container)
    sast                       Static Application Security Testing only
    dast                       Dynamic Application Security Testing only
    deps                       Dependency vulnerability scanning only
    container                  Container security scanning only

EXAMPLES:
    $0                                          # Run comprehensive scan with default settings
    $0 -t dast -u https://staging.example.com  # Run DAST against staging environment
    $0 -t deps -s critical                     # Run dependency scan for critical issues only
    $0 -v -c                                   # Verbose output, continue on findings

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            SCAN_TYPE="$2"
            shift 2
            ;;
        -s|--severity)
            SEVERITY_THRESHOLD="$2"
            shift 2
            ;;
        -u|--url)
            API_URL="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -c|--continue-on-fail)
            FAIL_ON_FINDINGS=false
            shift
            ;;
        -o|--output)
            SCAN_REPORT="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${BLUE}[VERBOSE]${NC} $1"
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check required tools
    local missing_tools=()

    command -v node >/dev/null 2>&1 || missing_tools+=("node")
    command -v npm >/dev/null 2>&1 || missing_tools+=("npm")
    command -v docker >/dev/null 2>&1 || missing_tools+=("docker")
    command -v curl >/dev/null 2>&1 || missing_tools+=("curl")
    command -v jq >/dev/null 2>&1 || missing_tools+=("jq")

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install the missing tools and try again."
        exit 1
    fi

    # Check if project dependencies are installed
    if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
        log_warning "Node modules not found. Installing dependencies..."
        cd "$PROJECT_ROOT"
        pnpm install --frozen-lockfile
    fi

    # Create reports directory
    mkdir -p "$REPORTS_DIR"

    log_success "Prerequisites check completed"
}

# Initialize security report
init_report() {
    log_info "Initializing security report..."

    cat > "$SCAN_REPORT" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Security Scan Report - ${TIMESTAMP}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #f4f4f4; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; padding: 15px; border-left: 4px solid #007cba; }
        .critical { border-left-color: #dc3545; }
        .high { border-left-color: #fd7e14; }
        .medium { border-left-color: #ffc107; }
        .low { border-left-color: #28a745; }
        .passed { color: #28a745; }
        .failed { color: #dc3545; }
        .warning { color: #fd7e14; }
        pre { background-color: #f8f9fa; padding: 10px; border-radius: 3px; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🛡️ Security Scan Report</h1>
        <p><strong>Scan Time:</strong> $(date)</p>
        <p><strong>Scan Type:</strong> ${SCAN_TYPE}</p>
        <p><strong>Severity Threshold:</strong> ${SEVERITY_THRESHOLD}</p>
        <p><strong>Target URL:</strong> ${API_URL}</p>
    </div>
EOF

    log_success "Security report initialized: $SCAN_REPORT"
}

# Add section to report
add_report_section() {
    local title="$1"
    local content="$2"
    local status="$3"
    local severity="${4:-medium}"

    cat >> "$SCAN_REPORT" << EOF
    <div class="section ${severity}">
        <h2>${title} <span class="${status}">[${status^^}]</span></h2>
        ${content}
    </div>
EOF
}

# Run SAST (Static Application Security Testing)
run_sast() {
    log_info "Running Static Application Security Testing (SAST)..."

    local sast_results=""
    local sast_status="passed"

    # ESLint security analysis
    log_verbose "Running ESLint security analysis..."
    cd "$PROJECT_ROOT"

    if pnpm run lint 2>&1 | tee "${REPORTS_DIR}/eslint_${TIMESTAMP}.log"; then
        log_success "ESLint security analysis passed"
        sast_results+="<h3>✅ ESLint Security Analysis</h3><p>No security-related linting issues found.</p>"
    else
        log_warning "ESLint security analysis found issues"
        sast_status="warning"
        sast_results+="<h3>⚠️ ESLint Security Analysis</h3><pre>$(cat "${REPORTS_DIR}/eslint_${TIMESTAMP}.log")</pre>"
    fi

    # Semgrep security analysis (if available)
    if command -v semgrep >/dev/null 2>&1; then
        log_verbose "Running Semgrep security analysis..."

        if semgrep --config=auto --json "${PROJECT_ROOT}/apps" > "${REPORTS_DIR}/semgrep_${TIMESTAMP}.json" 2>/dev/null; then
            local semgrep_findings=$(jq '.results | length' "${REPORTS_DIR}/semgrep_${TIMESTAMP}.json")

            if [[ "$semgrep_findings" -eq 0 ]]; then
                log_success "Semgrep analysis passed"
                sast_results+="<h3>✅ Semgrep Security Analysis</h3><p>No security vulnerabilities found.</p>"
            else
                log_warning "Semgrep found $semgrep_findings potential security issues"
                sast_status="failed"

                # Parse Semgrep results
                local semgrep_table="<table><tr><th>Rule</th><th>Severity</th><th>File</th><th>Line</th><th>Message</th></tr>"
                while IFS= read -r result; do
                    local rule_id=$(echo "$result" | jq -r '.check_id')
                    local severity=$(echo "$result" | jq -r '.extra.severity')
                    local file=$(echo "$result" | jq -r '.path')
                    local line=$(echo "$result" | jq -r '.start.line')
                    local message=$(echo "$result" | jq -r '.extra.message')

                    semgrep_table+="<tr><td>${rule_id}</td><td>${severity}</td><td>${file}</td><td>${line}</td><td>${message}</td></tr>"
                done < <(jq -c '.results[]' "${REPORTS_DIR}/semgrep_${TIMESTAMP}.json")
                semgrep_table+="</table>"

                sast_results+="<h3>❌ Semgrep Security Analysis</h3><p>Found $semgrep_findings security issues:</p>${semgrep_table}"
            fi
        else
            log_warning "Semgrep analysis failed"
            sast_results+="<h3>⚠️ Semgrep Security Analysis</h3><p>Analysis failed to complete.</p>"
        fi
    else
        log_verbose "Semgrep not available, skipping analysis"
        sast_results+="<h3>ℹ️ Semgrep Security Analysis</h3><p>Semgrep not installed, skipping analysis.</p>"
    fi

    # TypeScript security analysis
    log_verbose "Running TypeScript security analysis..."
    if pnpm run build --dry-run 2>&1 | tee "${REPORTS_DIR}/typescript_${TIMESTAMP}.log"; then
        log_success "TypeScript analysis passed"
        sast_results+="<h3>✅ TypeScript Security Analysis</h3><p>No type safety issues found.</p>"
    else
        log_warning "TypeScript analysis found issues"
        sast_status="warning"
        sast_results+="<h3>⚠️ TypeScript Security Analysis</h3><pre>$(cat "${REPORTS_DIR}/typescript_${TIMESTAMP}.log")</pre>"
    fi

    add_report_section "Static Application Security Testing (SAST)" "$sast_results" "$sast_status"
    return $([ "$sast_status" = "failed" ] && echo 1 || echo 0)
}

# Run dependency vulnerability scanning
run_dependency_scan() {
    log_info "Running dependency vulnerability scanning..."

    local deps_results=""
    local deps_status="passed"

    cd "$PROJECT_ROOT"

    # NPM audit
    log_verbose "Running NPM audit..."
    if pnpm audit --json > "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null; then
        local vulnerabilities=$(jq '.vulnerabilities | length' "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null || echo "0")

        if [[ "$vulnerabilities" -eq 0 ]]; then
            log_success "NPM audit passed - no vulnerabilities found"
            deps_results+="<h3>✅ NPM Audit</h3><p>No vulnerabilities found in dependencies.</p>"
        else
            log_warning "NPM audit found $vulnerabilities vulnerabilities"

            # Count by severity
            local critical=$(jq '.vulnerabilities | map(select(.severity == "critical")) | length' "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null || echo "0")
            local high=$(jq '.vulnerabilities | map(select(.severity == "high")) | length' "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null || echo "0")
            local moderate=$(jq '.vulnerabilities | map(select(.severity == "moderate")) | length' "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null || echo "0")
            local low=$(jq '.vulnerabilities | map(select(.severity == "low")) | length' "${REPORTS_DIR}/npm_audit_${TIMESTAMP}.json" 2>/dev/null || echo "0")

            # Determine status based on severity threshold
            case "$SEVERITY_THRESHOLD" in
                "critical")
                    [[ "$critical" -gt 0 ]] && deps_status="failed"
                    ;;
                "high")
                    [[ "$critical" -gt 0 || "$high" -gt 0 ]] && deps_status="failed"
                    ;;
                "medium")
                    [[ "$critical" -gt 0 || "$high" -gt 0 || "$moderate" -gt 0 ]] && deps_status="failed"
                    ;;
                "low")
                    [[ "$vulnerabilities" -gt 0 ]] && deps_status="failed"
                    ;;
            esac

            deps_results+="<h3>$([ "$deps_status" = "failed" ] && echo "❌" || echo "⚠️") NPM Audit</h3>"
            deps_results+="<p>Found vulnerabilities by severity:</p>"
            deps_results+="<ul><li>Critical: $critical</li><li>High: $high</li><li>Moderate: $moderate</li><li>Low: $low</li></ul>"
        fi
    else
        log_warning "NPM audit failed to run"
        deps_status="warning"
        deps_results+="<h3>⚠️ NPM Audit</h3><p>Failed to run dependency audit.</p>"
    fi

    # License compliance check
    log_verbose "Running license compliance check..."
    if command -v license-checker >/dev/null 2>&1; then
        if license-checker --json --onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD' > "${REPORTS_DIR}/licenses_${TIMESTAMP}.json" 2>/dev/null; then
            log_success "License compliance check passed"
            deps_results+="<h3>✅ License Compliance</h3><p>All dependencies use approved licenses.</p>"
        else
            log_warning "License compliance check found issues"
            deps_status="warning"
            deps_results+="<h3>⚠️ License Compliance</h3><p>Some dependencies may use non-compliant licenses.</p>"
        fi
    else
        log_verbose "license-checker not available"
        deps_results+="<h3>ℹ️ License Compliance</h3><p>license-checker not installed, skipping check.</p>"
    fi

    add_report_section "Dependency Vulnerability Scanning" "$deps_results" "$deps_status"
    return $([ "$deps_status" = "failed" ] && echo 1 || echo 0)
}

# Run container security scanning
run_container_scan() {
    log_info "Running container security scanning..."

    local container_results=""
    local container_status="passed"

    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_warning "Docker is not running, skipping container security scan"
        container_results="<h3>⚠️ Container Security Scan</h3><p>Docker is not running, unable to perform container security scanning.</p>"
        add_report_section "Container Security Scanning" "$container_results" "warning"
        return 0
    fi

    # Build test images for scanning
    log_verbose "Building container images for security scanning..."

    local services=("api" "workers" "admin" "client")
    local scan_results=""

    for service in "${services[@]}"; do
        local dockerfile="${PROJECT_ROOT}/apps/${service}/Dockerfile"

        if [[ -f "$dockerfile" ]]; then
            log_verbose "Building $service container for scanning..."

            # Build image
            if docker build -t "security-test:${service}" -f "$dockerfile" "$PROJECT_ROOT" >/dev/null 2>&1; then
                log_verbose "Successfully built $service image"

                # Run Trivy scan if available
                if command -v trivy >/dev/null 2>&1; then
                    log_verbose "Running Trivy scan on $service image..."

                    if trivy image --format json --output "${REPORTS_DIR}/trivy_${service}_${TIMESTAMP}.json" "security-test:${service}" >/dev/null 2>&1; then
                        local vulnerabilities=$(jq '.Results[0].Vulnerabilities // [] | length' "${REPORTS_DIR}/trivy_${service}_${TIMESTAMP}.json" 2>/dev/null || echo "0")

                        if [[ "$vulnerabilities" -eq 0 ]]; then
                            scan_results+="<h4>✅ $service Container</h4><p>No vulnerabilities found.</p>"
                        else
                            local critical=$(jq '.Results[0].Vulnerabilities // [] | map(select(.Severity == "CRITICAL")) | length' "${REPORTS_DIR}/trivy_${service}_${TIMESTAMP}.json" 2>/dev/null || echo "0")
                            local high=$(jq '.Results[0].Vulnerabilities // [] | map(select(.Severity == "HIGH")) | length' "${REPORTS_DIR}/trivy_${service}_${TIMESTAMP}.json" 2>/dev/null || echo "0")
                            local medium=$(jq '.Results[0].Vulnerabilities // [] | map(select(.Severity == "MEDIUM")) | length' "${REPORTS_DIR}/trivy_${service}_${TIMESTAMP}.json" 2>/dev/null || echo "0")

                            # Check if exceeds threshold
                            case "$SEVERITY_THRESHOLD" in
                                "critical")
                                    [[ "$critical" -gt 0 ]] && container_status="failed"
                                    ;;
                                "high")
                                    [[ "$critical" -gt 0 || "$high" -gt 0 ]] && container_status="failed"
                                    ;;
                                "medium")
                                    [[ "$critical" -gt 0 || "$high" -gt 0 || "$medium" -gt 0 ]] && container_status="failed"
                                    ;;
                            esac

                            scan_results+="<h4>$([ "$critical" -gt 0 ] && echo "❌" || [ "$high" -gt 0 ] && echo "⚠️" || echo "ℹ️") $service Container</h4>"
                            scan_results+="<p>Vulnerabilities: Critical: $critical, High: $high, Medium: $medium</p>"
                        fi
                    else
                        scan_results+="<h4>⚠️ $service Container</h4><p>Trivy scan failed.</p>"
                    fi
                else
                    scan_results+="<h4>ℹ️ $service Container</h4><p>Trivy not available for scanning.</p>"
                fi

                # Cleanup test image
                docker rmi "security-test:${service}" >/dev/null 2>&1
            else
                log_warning "Failed to build $service container"
                scan_results+="<h4>⚠️ $service Container</h4><p>Failed to build container image.</p>"
            fi
        else
            log_verbose "Dockerfile not found for $service, skipping"
        fi
    done

    container_results="<h3>Container Security Scanning Results</h3>$scan_results"
    add_report_section "Container Security Scanning" "$container_results" "$container_status"
    return $([ "$container_status" = "failed" ] && echo 1 || echo 0)
}

# Run DAST (Dynamic Application Security Testing)
run_dast() {
    log_info "Running Dynamic Application Security Testing (DAST)..."

    local dast_results=""
    local dast_status="passed"

    # Check if target URL is accessible
    log_verbose "Checking if target URL is accessible: $API_URL"
    if ! curl -s -f "$API_URL/health" >/dev/null 2>&1; then
        log_warning "Target URL $API_URL is not accessible"
        dast_results="<h3>⚠️ DAST Scan</h3><p>Target URL $API_URL is not accessible. DAST scanning skipped.</p>"
        add_report_section "Dynamic Application Security Testing (DAST)" "$dast_results" "warning"
        return 0
    fi

    # Basic security headers check
    log_verbose "Checking security headers..."
    local headers_result=$(curl -s -I "$API_URL/health")
    local headers_analysis=""

    # Check for important security headers
    if echo "$headers_result" | grep -i "strict-transport-security" >/dev/null; then
        headers_analysis+="✅ Strict-Transport-Security header present<br>"
    else
        headers_analysis+="❌ Strict-Transport-Security header missing<br>"
        dast_status="warning"
    fi

    if echo "$headers_result" | grep -i "x-content-type-options" >/dev/null; then
        headers_analysis+="✅ X-Content-Type-Options header present<br>"
    else
        headers_analysis+="❌ X-Content-Type-Options header missing<br>"
        dast_status="warning"
    fi

    if echo "$headers_result" | grep -i "x-frame-options" >/dev/null; then
        headers_analysis+="✅ X-Frame-Options header present<br>"
    else
        headers_analysis+="❌ X-Frame-Options header missing<br>"
        dast_status="warning"
    fi

    if echo "$headers_result" | grep -i "content-security-policy" >/dev/null; then
        headers_analysis+="✅ Content-Security-Policy header present<br>"
    else
        headers_analysis+="❌ Content-Security-Policy header missing<br>"
        dast_status="warning"
    fi

    # Basic injection testing
    log_verbose "Running basic injection tests..."
    local injection_tests=""

    # Test SQL injection in query parameters
    local sql_test_url="${API_URL}/api/posts?search=test%27%20OR%20%271%27%3D%271"
    if curl -s "$sql_test_url" | grep -i "error\|exception\|sql" >/dev/null; then
        injection_tests+="❌ Potential SQL injection vulnerability detected<br>"
        dast_status="failed"
    else
        injection_tests+="✅ SQL injection test passed<br>"
    fi

    # Test XSS in query parameters
    local xss_test_url="${API_URL}/api/posts?search=%3Cscript%3Ealert%28%27xss%27%29%3C%2Fscript%3E"
    if curl -s "$xss_test_url" | grep -i "<script>" >/dev/null; then
        injection_tests+="❌ Potential XSS vulnerability detected<br>"
        dast_status="failed"
    else
        injection_tests+="✅ XSS injection test passed<br>"
    fi

    dast_results="<h3>Security Headers Analysis</h3><p>$headers_analysis</p>"
    dast_results+="<h3>Basic Injection Tests</h3><p>$injection_tests</p>"

    # Run OWASP ZAP if available
    if command -v zap-cli >/dev/null 2>&1; then
        log_verbose "Running OWASP ZAP scan..."
        # ZAP scanning would be implemented here
        dast_results+="<h3>OWASP ZAP Scan</h3><p>ZAP scanning not implemented in this version.</p>"
    else
        dast_results+="<h3>OWASP ZAP Scan</h3><p>ZAP not available, basic security checks performed instead.</p>"
    fi

    add_report_section "Dynamic Application Security Testing (DAST)" "$dast_results" "$dast_status"
    return $([ "$dast_status" = "failed" ] && echo 1 || echo 0)
}

# Run custom security tests
run_custom_tests() {
    log_info "Running custom security tests..."

    local custom_results=""
    local custom_status="passed"

    cd "$PROJECT_ROOT"

    # Run security-specific tests
    log_verbose "Running authentication security tests..."
    if pnpm --filter @apps/api test:auth >/dev/null 2>&1; then
        custom_results+="<h4>✅ Authentication Security Tests</h4><p>All authentication security tests passed.</p>"
    else
        custom_results+="<h4>❌ Authentication Security Tests</h4><p>Some authentication security tests failed.</p>"
        custom_status="failed"
    fi

    log_verbose "Running input validation security tests..."
    if pnpm --filter @apps/api test:security >/dev/null 2>&1; then
        custom_results+="<h4>✅ Input Validation Security Tests</h4><p>All input validation tests passed.</p>"
    else
        custom_results+="<h4>❌ Input Validation Security Tests</h4><p>Some input validation tests failed.</p>"
        custom_status="failed"
    fi

    log_verbose "Running RBAC security tests..."
    if pnpm --filter @apps/api test:rbac >/dev/null 2>&1; then
        custom_results+="<h4>✅ RBAC Security Tests</h4><p>All RBAC security tests passed.</p>"
    else
        custom_results+="<h4>❌ RBAC Security Tests</h4><p>Some RBAC security tests failed.</p>"
        custom_status="failed"
    fi

    add_report_section "Custom Security Tests" "$custom_results" "$custom_status"
    return $([ "$custom_status" = "failed" ] && echo 1 || echo 0)
}

# Finalize report
finalize_report() {
    log_info "Finalizing security report..."

    cat >> "$SCAN_REPORT" << EOF
    <div class="section">
        <h2>📊 Scan Summary</h2>
        <p><strong>Scan completed at:</strong> $(date)</p>
        <p><strong>Report location:</strong> $SCAN_REPORT</p>
        <p><strong>Command used:</strong> $0 $*</p>
    </div>
</body>
</html>
EOF

    log_success "Security report finalized: $SCAN_REPORT"

    # Open report in browser if available
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$SCAN_REPORT" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "$SCAN_REPORT" >/dev/null 2>&1 &
    fi
}

# Main execution
main() {
    log_info "Starting security scan (type: $SCAN_TYPE, severity: $SEVERITY_THRESHOLD)"

    check_prerequisites
    init_report

    local exit_code=0

    case "$SCAN_TYPE" in
        "comprehensive")
            run_sast || exit_code=1
            run_dependency_scan || exit_code=1
            run_container_scan || exit_code=1
            run_dast || exit_code=1
            run_custom_tests || exit_code=1
            ;;
        "sast")
            run_sast || exit_code=1
            ;;
        "dast")
            run_dast || exit_code=1
            ;;
        "deps")
            run_dependency_scan || exit_code=1
            ;;
        "container")
            run_container_scan || exit_code=1
            ;;
        "custom")
            run_custom_tests || exit_code=1
            ;;
        *)
            log_error "Unknown scan type: $SCAN_TYPE"
            show_help
            exit 1
            ;;
    esac

    finalize_report

    if [[ $exit_code -ne 0 && "$FAIL_ON_FINDINGS" == true ]]; then
        log_error "Security scan completed with findings above threshold"
        log_error "Review the report at: $SCAN_REPORT"
        exit 1
    else
        log_success "Security scan completed successfully"
        log_info "Report available at: $SCAN_REPORT"
        exit 0
    fi
}

# Trap signals for cleanup
trap 'log_error "Security scan interrupted"; exit 130' INT TERM

# Run main function
main "$@"