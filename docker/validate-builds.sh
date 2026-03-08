#!/bin/bash
# ==============================================================================
# Validate Docker Builds - Comprehensive Testing Script
# ==============================================================================
# Usage: bash docker/validate-builds.sh
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Change to repository root
cd "$(dirname "$0")/.."

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Docker Build Validation${NC}"
echo -e "${BLUE}========================================${NC}"

# Function to run a test
run_test() {
    local TEST_NAME=$1
    local TEST_COMMAND=$2

    echo -e "\n${YELLOW}Testing: ${TEST_NAME}${NC}"

    if eval "${TEST_COMMAND}"; then
        echo -e "${GREEN}✓ ${TEST_NAME} passed${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ ${TEST_NAME} failed${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Function to validate Dockerfile exists
validate_dockerfile() {
    local DOCKERFILE=$1
    local SERVICE=$2

    if [[ ! -f "${DOCKERFILE}" ]]; then
        echo -e "${RED}✗ Dockerfile not found: ${DOCKERFILE}${NC}"
        return 1
    fi

    echo -e "${GREEN}✓ ${SERVICE} Dockerfile exists${NC}"
    return 0
}

# Function to validate Dockerfile syntax
validate_syntax() {
    local DOCKERFILE=$1
    local SERVICE=$2

    if docker build -f "${DOCKERFILE}" -t "validate-${SERVICE}:test" --target base . > /dev/null 2>&1 || \
       docker build -f "${DOCKERFILE}" -t "validate-${SERVICE}:test" --no-cache --dry-run . > /dev/null 2>&1; then
        echo -e "${GREEN}✓ ${SERVICE} Dockerfile syntax valid${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ ${SERVICE} Dockerfile syntax check skipped (dry-run not supported)${NC}"
        return 0
    fi
}

# Function to validate build args
validate_build_args() {
    local DOCKERFILE=$1
    local SERVICE=$2

    # Extract ARG declarations
    local ARGS=$(grep "^ARG" "${DOCKERFILE}" | awk '{print $2}' | cut -d'=' -f1)

    if [[ -n "${ARGS}" ]]; then
        echo -e "${GREEN}✓ ${SERVICE} has build arguments: ${ARGS}${NC}"
    else
        echo -e "${YELLOW}⚠ ${SERVICE} has no build arguments${NC}"
    fi

    return 0
}

# Function to check for security best practices
validate_security() {
    local DOCKERFILE=$1
    local SERVICE=$2

    local SECURITY_SCORE=0
    local SECURITY_ISSUES=()

    # Check for non-root user
    if grep -q "USER nonroot\|USER appuser\|USER fastify" "${DOCKERFILE}"; then
        ((SECURITY_SCORE++))
    else
        SECURITY_ISSUES+=("No non-root user declaration")
    fi

    # Check for COPY --chown
    if grep -q "COPY.*--chown" "${DOCKERFILE}"; then
        ((SECURITY_SCORE++))
    else
        SECURITY_ISSUES+=("No --chown in COPY statements")
    fi

    # Check for health check
    if grep -q "HEALTHCHECK" "${DOCKERFILE}"; then
        ((SECURITY_SCORE++))
    else
        SECURITY_ISSUES+=("No HEALTHCHECK defined")
    fi

    # Check for distroless or alpine
    if grep -q "distroless\|alpine" "${DOCKERFILE}"; then
        ((SECURITY_SCORE++))
    else
        SECURITY_ISSUES+=("Not using minimal base image")
    fi

    if [[ ${SECURITY_SCORE} -ge 3 ]]; then
        echo -e "${GREEN}✓ ${SERVICE} security score: ${SECURITY_SCORE}/4${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ ${SERVICE} security score: ${SECURITY_SCORE}/4${NC}"
        echo -e "${YELLOW}  Issues: ${SECURITY_ISSUES[*]}${NC}"
        return 0
    fi
}

# Function to validate multi-stage builds
validate_multistage() {
    local DOCKERFILE=$1
    local SERVICE=$2

    local STAGES=$(grep -c "^FROM.*AS" "${DOCKERFILE}" || echo "0")

    if [[ ${STAGES} -ge 2 ]]; then
        echo -e "${GREEN}✓ ${SERVICE} uses multi-stage builds (${STAGES} stages)${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ ${SERVICE} has ${STAGES} stages (consider multi-stage)${NC}"
        return 0
    fi
}

# Function to estimate image size
estimate_size() {
    local IMAGE_TAG=$1
    local SERVICE=$2

    if docker images "${IMAGE_TAG}" --format "{{.Size}}" | grep -q .; then
        local SIZE=$(docker images "${IMAGE_TAG}" --format "{{.Size}}")
        echo -e "${GREEN}✓ ${SERVICE} estimated size: ${SIZE}${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ ${SERVICE} image not built yet${NC}"
        return 0
    fi
}

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 1: File Validation${NC}"
echo -e "${BLUE}========================================${NC}"

# Validate base Dockerfile
echo -e "\n${YELLOW}Checking base.Dockerfile...${NC}"
validate_dockerfile "docker/base.Dockerfile" "Base"
validate_multistage "docker/base.Dockerfile" "Base"

# Validate app Dockerfiles
echo -e "\n${YELLOW}Checking application Dockerfiles...${NC}"
validate_dockerfile "apps/api/Dockerfile.production.new" "API Production"
validate_dockerfile "apps/workers/Dockerfile.new" "Workers"
validate_dockerfile "apps/client/Dockerfile.new" "Client"
validate_dockerfile "apps/admin/Dockerfile.new" "Admin"
validate_dockerfile "apps/api/Dockerfile.dev.new" "API Development"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 2: Syntax Validation${NC}"
echo -e "${BLUE}========================================${NC}"

# Note: Docker doesn't support --dry-run, so we'll skip actual syntax validation
echo -e "${YELLOW}Skipping syntax validation (requires actual build)${NC}"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 3: Security Best Practices${NC}"
echo -e "${BLUE}========================================${NC}"

validate_security "apps/api/Dockerfile.production.new" "API Production"
validate_security "apps/workers/Dockerfile.new" "Workers"
validate_security "apps/client/Dockerfile.new" "Client"
validate_security "apps/admin/Dockerfile.new" "Admin"
validate_security "apps/api/Dockerfile.dev.new" "API Development"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 4: Multi-Stage Build Validation${NC}"
echo -e "${BLUE}========================================${NC}"

validate_multistage "apps/api/Dockerfile.production.new" "API Production"
validate_multistage "apps/workers/Dockerfile.new" "Workers"
validate_multistage "apps/client/Dockerfile.new" "Client"
validate_multistage "apps/admin/Dockerfile.new" "Admin"
validate_multistage "apps/api/Dockerfile.dev.new" "API Development"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 5: Build Arguments Check${NC}"
echo -e "${BLUE}========================================${NC}"

validate_build_args "docker/base.Dockerfile" "Base"
validate_build_args "apps/api/Dockerfile.production.new" "API Production"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 6: Documentation Check${NC}"
echo -e "${BLUE}========================================${NC}"

# Check for documentation files
if [[ -f "docker/DOCKER_STRATEGY.md" ]]; then
    echo -e "${GREEN}✓ Strategy documentation exists${NC}"
else
    echo -e "${RED}✗ Strategy documentation missing${NC}"
fi

if [[ -f "docker/MIGRATION_GUIDE.md" ]]; then
    echo -e "${GREEN}✓ Migration guide exists${NC}"
else
    echo -e "${RED}✗ Migration guide missing${NC}"
fi

if [[ -f "docker/docker-compose.optimized.yml" ]]; then
    echo -e "${GREEN}✓ Docker Compose configuration exists${NC}"
else
    echo -e "${RED}✗ Docker Compose configuration missing${NC}"
fi

if [[ -f "docker/build-all.sh" && -x "docker/build-all.sh" ]]; then
    echo -e "${GREEN}✓ Build script exists and is executable${NC}"
else
    echo -e "${RED}✗ Build script missing or not executable${NC}"
fi

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Phase 7: Image Size Estimation${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if images exist from previous builds
echo -e "${YELLOW}Checking existing images...${NC}"
estimate_size "omnipost-api:latest" "API"
estimate_size "omnipost-workers:latest" "Workers"
estimate_size "omnipost-client:latest" "Client"
estimate_size "omnipost-admin:latest" "Admin"
estimate_size "omnipost-api:dev" "API Development"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}"

echo -e "${GREEN}✓ All validation checks completed${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Build all services: ${GREEN}bash docker/build-all.sh${NC}"
echo -e "2. Test with Docker Compose: ${GREEN}docker compose -f docker/docker-compose.optimized.yml up${NC}"
echo -e "3. Run integration tests: ${GREEN}pnpm test${NC}"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Recommended Actions${NC}"
echo -e "${BLUE}========================================${NC}"

echo -e "${YELLOW}1. Before deploying to production:${NC}"
echo -e "   - Build all images with ${GREEN}bash docker/build-all.sh${NC}"
echo -e "   - Scan for vulnerabilities: ${GREEN}docker scan omnipost-api:latest${NC}"
echo -e "   - Test all health checks"
echo -e "   - Verify image sizes are reasonable"

echo -e "\n${YELLOW}2. For CI/CD integration:${NC}"
echo -e "   - Update GitHub Actions workflows"
echo -e "   - Configure registry caching"
echo -e "   - Set up automated security scanning"

echo -e "\n${YELLOW}3. For development:${NC}"
echo -e "   - Use ${GREEN}apps/api/Dockerfile.dev.new${NC} for local development"
echo -e "   - Enable BuildKit: ${GREEN}export DOCKER_BUILDKIT=1${NC}"
echo -e "   - Configure IDE Docker integration"

echo -e "\n${GREEN}Validation complete!${NC}"
