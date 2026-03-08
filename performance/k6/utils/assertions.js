import { check } from "k6";

export class PerformanceAssertions {
  constructor(thresholds = {}) {
    this.thresholds = {
      responseTime: {
        p95: thresholds.responseTime?.p95 || 200,
        p99: thresholds.responseTime?.p99 || 500,
        max: thresholds.responseTime?.max || 2000,
      },
      errorRate: thresholds.errorRate?.max || 1.0,
      ...thresholds,
    };
  }

  /**
   * Check API response performance and correctness
   */
  checkApiResponse(response, expectedStatus = 200, checks = {}) {
    const defaultChecks = {
      [`status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
      "response time < 2s": (r) => r.timings.duration < 2000,
      "response has body": (r) => r.body && r.body.length > 0,
    };

    // Add custom checks
    const allChecks = { ...defaultChecks, ...checks };

    return check(response, allChecks);
  }

  /**
   * Check authentication flow
   */
  checkAuthFlow(response, expectToken = true) {
    const checks = {
      "auth status is 200 or 201": (r) => r.status === 200 || r.status === 201,
      "response time < 1s": (r) => r.timings.duration < 1000,
    };

    if (expectToken) {
      checks["has token"] = (r) => r.json("token") !== undefined;
      checks["token is string"] = (r) => typeof r.json("token") === "string";
      checks["token length > 10"] = (r) => r.json("token").length > 10;
    }

    return check(response, checks);
  }

  /**
   * Check database operation performance
   */
  checkDatabaseOperation(response, operationType = "read") {
    const timeThresholds = {
      read: 100, // 100ms for reads
      write: 200, // 200ms for writes
      complex: 500, // 500ms for complex queries
    };

    const threshold = timeThresholds[operationType] || 200;

    return check(response, {
      [`db ${operationType} status is 200`]: (r) => r.status === 200,
      [`db ${operationType} time < ${threshold}ms`]: (r) => r.timings.duration < threshold,
      "response has data": (r) => r.json() !== null,
    });
  }

  /**
   * Check rate limiting compliance
   */
  checkRateLimit(response, expectRateLimit = false) {
    const checks = {
      "rate limit headers present": (r) =>
        r.headers["X-RateLimit-Limit"] !== undefined ||
        r.headers["x-ratelimit-limit"] !== undefined,
    };

    if (expectRateLimit) {
      checks["rate limit status is 429"] = (r) => r.status === 429;
      checks["rate limit has retry header"] = (r) =>
        r.headers["Retry-After"] !== undefined || r.headers["retry-after"] !== undefined;
    } else {
      checks["request not rate limited"] = (r) => r.status !== 429;
    }

    return check(response, checks);
  }

  /**
   * Check provider API integration
   */
  checkProviderIntegration(response, provider) {
    const providerChecks = {
      x: {
        "x api response valid": (r) => r.status === 200 || r.status === 201,
        "x api has rate limit headers": (r) => r.headers["x-rate-limit-remaining"] !== undefined,
      },
      facebook: {
        "facebook api response valid": (r) => r.status === 200,
        "facebook api has data": (r) => r.json("data") !== undefined,
      },
      instagram: {
        "instagram api response valid": (r) => r.status === 200,
        "instagram media id present": (r) => r.json("id") !== undefined,
      },
      youtube: {
        "youtube api response valid": (r) => r.status === 200,
        "youtube video id present": (r) => r.json("id") !== undefined,
      },
      default: {
        "provider api response valid": (r) => r.status >= 200 && r.status < 300,
        "provider api response time < 3s": (r) => r.timings.duration < 3000,
      },
    };

    const checks = providerChecks[provider] || providerChecks.default;
    return check(response, checks);
  }

  /**
   * Check pagination performance
   */
  checkPagination(response, expectedPageSize = 20) {
    return check(response, {
      "pagination status is 200": (r) => r.status === 200,
      "pagination response time < 200ms": (r) => r.timings.duration < 200,
      "has pagination data": (r) => r.json("data") !== undefined,
      "has pagination meta": (r) => r.json("meta") !== undefined,
      [`page size <= ${expectedPageSize}`]: (r) => {
        const data = r.json("data");
        return Array.isArray(data) && data.length <= expectedPageSize;
      },
    });
  }

  /**
   * Check analytics query performance
   */
  checkAnalyticsQuery(response, timeRange = "week") {
    const timeThresholds = {
      day: 100,
      week: 200,
      month: 500,
      year: 1000,
    };

    const threshold = timeThresholds[timeRange] || 300;

    return check(response, {
      "analytics status is 200": (r) => r.status === 200,
      [`analytics query time < ${threshold}ms`]: (r) => r.timings.duration < threshold,
      "has analytics data": (r) => r.json("data") !== undefined,
      "has metrics": (r) => {
        const data = r.json("data");
        return data && typeof data === "object" && Object.keys(data).length > 0;
      },
    });
  }

  /**
   * Check file upload performance
   */
  checkFileUpload(response, fileSize = 0) {
    const expectedTime = Math.max(1000, fileSize / 1000); // 1s minimum, +1s per MB

    return check(response, {
      "upload status is 200 or 201": (r) => r.status === 200 || r.status === 201,
      [`upload time reasonable for ${fileSize} bytes`]: (r) => r.timings.duration < expectedTime,
      "upload response has file info": (r) =>
        r.json("id") !== undefined || r.json("url") !== undefined,
    });
  }

  /**
   * Check bulk operation performance
   */
  checkBulkOperation(response, itemCount = 1) {
    const expectedTime = Math.max(500, itemCount * 50); // 500ms minimum, +50ms per item

    return check(response, {
      "bulk operation status is 200": (r) => r.status === 200,
      [`bulk operation time reasonable for ${itemCount} items`]: (r) =>
        r.timings.duration < expectedTime,
      "bulk operation has results": (r) => {
        const results = r.json("results") || r.json("data");
        return Array.isArray(results);
      },
    });
  }

  /**
   * Check cache performance
   */
  checkCacheHit(response, expectCacheHit = true) {
    const checks = {
      "cache response status is 200": (r) => r.status === 200,
      "cache response time < 50ms": (r) => r.timings.duration < 50,
    };

    if (expectCacheHit) {
      checks["cache hit header present"] = (r) =>
        r.headers["X-Cache"] === "HIT" ||
        r.headers["x-cache"] === "HIT" ||
        r.headers["X-Cache-Status"] === "hit";
    }

    return check(response, checks);
  }

  /**
   * Check circuit breaker behavior
   */
  checkCircuitBreaker(response, expectOpen = false) {
    if (expectOpen) {
      return check(response, {
        "circuit breaker open status": (r) => r.status === 503,
        "circuit breaker fast fail": (r) => r.timings.duration < 100,
        "circuit breaker error message": (r) =>
          r.body.includes("circuit") || r.body.includes("breaker"),
      });
    }

    return check(response, {
      "circuit breaker closed - normal operation": (r) => r.status !== 503,
      "circuit breaker response time normal": (r) => r.timings.duration < 2000,
    });
  }

  /**
   * Check health endpoint
   */
  checkHealthEndpoint(response) {
    return check(response, {
      "health status is 200": (r) => r.status === 200,
      "health response time < 100ms": (r) => r.timings.duration < 100,
      "health status is healthy": (r) => {
        const body = r.json();
        return body.ok === true || body.status === "healthy";
      },
      "health has timestamp": (r) => r.json("timestamp") !== undefined,
    });
  }

  /**
   * Generate performance report
   */
  generateReport(testName, responses) {
    const totalRequests = responses.length;
    const successfulRequests = responses.filter((r) => r.status >= 200 && r.status < 300).length;
    const errorRate = ((totalRequests - successfulRequests) / totalRequests) * 100;

    const responseTimes = responses.map((r) => r.timings.duration);
    responseTimes.sort((a, b) => a - b);

    const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
    const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
    const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];

    return {
      testName,
      totalRequests,
      successfulRequests,
      errorRate: errorRate.toFixed(2),
      responseTime: {
        min: Math.min(...responseTimes),
        max: Math.max(...responseTimes),
        avg: responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length,
        p50,
        p95,
        p99,
      },
      thresholdsPassed: {
        errorRate: errorRate <= this.thresholds.errorRate,
        p95ResponseTime: p95 <= this.thresholds.responseTime.p95,
        p99ResponseTime: p99 <= this.thresholds.responseTime.p99,
      },
    };
  }
}
