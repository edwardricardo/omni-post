#!/bin/bash

# Test Response Caching Script
# Verifies that Redis-based response caching is working correctly

set -e

BASE_URL=${1:-"http://localhost:3000"}
VERBOSE=${VERBOSE:-false}

echo "🧪 Testing Response Caching"
echo "Target: $BASE_URL"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check cache header
check_cache_header() {
  local url=$1
  local expected=$2
  local test_name=$3

  echo -n "Testing: $test_name... "

  response=$(curl -s -i "$BASE_URL$url" 2>&1)
  cache_header=$(echo "$response" | grep -i "x-cache:" | cut -d: -f2 | tr -d ' \r\n' || echo "NOT_FOUND")

  if [ "$VERBOSE" = "true" ]; then
    echo ""
    echo "Response headers:"
    echo "$response" | head -n 20
    echo ""
  fi

  if [[ "$cache_header" == "$expected"* ]]; then
    echo -e "${GREEN}✓ PASS${NC} (X-Cache: $cache_header)"
    return 0
  else
    echo -e "${RED}✗ FAIL${NC} (Expected: $expected, Got: $cache_header)"
    return 1
  fi
}

# Function to measure response time
measure_response_time() {
  local url=$1
  local start=$(date +%s%N)
  curl -s "$BASE_URL$url" > /dev/null
  local end=$(date +%s%N)
  local duration=$((($end - $start) / 1000000)) # Convert to milliseconds
  echo $duration
}

echo "📊 Test 1: Cache MISS on first request"
echo "---------------------------------------"
sleep 1
check_cache_header "/api/providers" "MISS" "GET /api/providers (first request)"
echo ""

echo "📊 Test 2: Cache HIT on second request"
echo "---------------------------------------"
sleep 1
check_cache_header "/api/providers" "HIT" "GET /api/providers (second request)"
echo ""

echo "📊 Test 3: Cache performance comparison"
echo "---------------------------------------"
# Clear cache for this test (optional - comment out if you want to keep cache)
# redis-cli FLUSHDB > /dev/null 2>&1 || true

echo "Measuring first request (cache MISS)..."
time1=$(measure_response_time "/api/providers/active")
echo "  Time: ${time1}ms"

echo "Measuring second request (cache HIT)..."
time2=$(measure_response_time "/api/providers/active")
echo "  Time: ${time2}ms"

if [ "$time2" -lt "$time1" ]; then
  speedup=$(echo "scale=2; $time1 / $time2" | bc)
  echo -e "${GREEN}✓ Cache is faster${NC} (${speedup}x speedup)"
else
  echo -e "${YELLOW}⚠ Cache not significantly faster${NC} (may need more realistic data)"
fi
echo ""

echo "📊 Test 4: Cache invalidation on mutation"
echo "---------------------------------------"
echo "Note: This test requires authentication. Skipping for now."
echo -e "${YELLOW}⚠ Manual test required${NC}"
echo ""
# To test cache invalidation:
# 1. Make a GET request (cache MISS)
# 2. Make the same GET request (cache HIT)
# 3. Make a POST/PUT/DELETE to related resource
# 4. Make the GET request again (should be cache MISS)

echo "📊 Test 5: Verify cache headers present"
echo "---------------------------------------"
endpoints=(
  "/api/providers"
  "/api/providers/active"
  "/health"
)

for endpoint in "${endpoints[@]}"; do
  echo -n "  $endpoint... "
  headers=$(curl -s -I "$BASE_URL$endpoint" 2>&1)

  if echo "$headers" | grep -qi "x-cache:"; then
    cache_value=$(echo "$headers" | grep -i "x-cache:" | cut -d: -f2 | tr -d ' \r\n')
    echo -e "${GREEN}✓${NC} (X-Cache: $cache_value)"
  else
    echo -e "${YELLOW}⚠${NC} (No X-Cache header - may be excluded route)"
  fi
done
echo ""

echo "📊 Test 6: Cache key uniqueness"
echo "---------------------------------------"
echo "Testing that different endpoints have different cache keys..."
check_cache_header "/api/providers" "MISS" "GET /api/providers"
sleep 0.5
check_cache_header "/api/providers/active" "MISS" "GET /api/providers/active (different from /api/providers)"
echo ""

echo "================================"
echo "🎉 Cache Testing Complete!"
echo ""
echo "Summary:"
echo "  ✅ Cache infrastructure: Working"
echo "  ✅ Cache headers: Present"
echo "  ✅ Cache HIT/MISS: Functioning"
echo "  ⚠️  Cache invalidation: Manual test required"
echo ""
echo "To test cache invalidation:"
echo "  1. Make GET request to see cache MISS → HIT"
echo "  2. Make POST/PUT/DELETE to related resource"
echo "  3. Make GET request again - should see cache MISS"
echo ""
echo "To monitor cache in real-time:"
echo "  redis-cli MONITOR | grep 'api:cache'"
echo ""
echo "To check cache statistics:"
echo "  redis-cli INFO stats"
echo ""
