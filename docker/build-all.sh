#!/bin/bash
# ==============================================================================
# Build All Services Using Optimized Dockerfiles
# ==============================================================================
# Usage: bash docker/build-all.sh [--no-cache]
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
NO_CACHE_FLAG=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE_FLAG="--no-cache"
    echo -e "${YELLOW}Building with --no-cache flag${NC}"
fi

# Change to repository root
cd "$(dirname "$0")/.."

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Building omni-post Services${NC}"
echo -e "${GREEN}========================================${NC}"

# Function to build a service
build_service() {
    local SERVICE_NAME=$1
    local DOCKERFILE_PATH=$2
    local TAG=$3

    echo -e "\n${YELLOW}Building ${SERVICE_NAME}...${NC}"

    if DOCKER_BUILDKIT=1 docker build \
        ${NO_CACHE_FLAG} \
        -f "${DOCKERFILE_PATH}" \
        -t "${TAG}" \
        .; then
        echo -e "${GREEN}✓ ${SERVICE_NAME} built successfully${NC}"
    else
        echo -e "${RED}✗ Failed to build ${SERVICE_NAME}${NC}"
        exit 1
    fi
}

# Build all services
build_service "API (Production)" "apps/api/Dockerfile.production.new" "omnipost-api:latest"
build_service "Workers" "apps/workers/Dockerfile.new" "omnipost-workers:latest"
build_service "Client" "apps/client/Dockerfile.new" "omnipost-client:latest"
build_service "Admin" "apps/admin/Dockerfile.new" "omnipost-admin:latest"
build_service "API (Development)" "apps/api/Dockerfile.dev.new" "omnipost-api:dev"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}All services built successfully!${NC}"
echo -e "${GREEN}========================================${NC}"

# Display image sizes
echo -e "\n${YELLOW}Image Sizes:${NC}"
docker images | grep "omnipost-" | awk '{print $1":"$2 "\t" $7$8}'

echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Run services: ${GREEN}docker compose -f docker/docker-compose.optimized.yml up${NC}"
echo -e "2. Test API: ${GREEN}curl http://localhost:3000/health${NC}"
echo -e "3. View logs: ${GREEN}docker compose -f docker/docker-compose.optimized.yml logs -f${NC}"
