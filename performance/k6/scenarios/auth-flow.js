import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import { AuthHelper } from "../utils/auth-helpers.js";
import { PerformanceAssertions } from "../utils/assertions.js";

// Custom metrics
const authSuccessRate = new Rate("auth_success_rate");
const loginDuration = new Trend("login_duration");
const tokenValidationDuration = new Trend("token_validation_duration");
const mfaSetupDuration = new Trend("mfa_setup_duration");

// Test configuration
export const options = {
  stages: [
    { duration: "30s", target: 50 }, // Ramp up to 50 users
    { duration: "2m", target: 50 }, // Stay at 50 users
    { duration: "30s", target: 100 }, // Ramp up to 100 users
    { duration: "3m", target: 100 }, // Stay at 100 users
    { duration: "30s", target: 200 }, // Ramp up to 200 users
    { duration: "2m", target: 200 }, // Stay at 200 users
    { duration: "1m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
    auth_success_rate: ["rate>0.99"],
    login_duration: ["p(95)<300"],
    token_validation_duration: ["p(95)<100"],
    checks: ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const authHelper = new AuthHelper(BASE_URL);
const assertions = new PerformanceAssertions();

export function setup() {
  console.log("Setting up auth flow performance test...");

  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API is accessible": (r) => r.status === 200,
  });

  return {
    baseUrl: BASE_URL,
    testStartTime: new Date().toISOString(),
  };
}

export default function authFlowTest(/* data */) {
  const userIndex = Math.floor(Math.random() * 1000000);

  group("Authentication Flow Performance", () => {
    // Test 1: User Registration
    group("User Registration", () => {
      const startTime = Date.now();

      try {
        const user = authHelper.createTestUser(userIndex);
        // Track duration
        Date.now() - startTime;

        authSuccessRate.add(true);

        check(user, {
          "registration has token": (u) => u.token !== undefined,
          "registration has user id": (u) => u.userId !== undefined,
        });

        sleep(0.5);
      } catch (error) {
        authSuccessRate.add(false);
        console.error("Registration failed:", error);
      }
    });

    // Test 2: User Login
    group("User Login", () => {
      const startTime = Date.now();

      try {
        const auth = authHelper.authenticate(userIndex);
        const duration = Date.now() - startTime;

        loginDuration.add(duration);
        authSuccessRate.add(true);

        check(auth, {
          "login has token": (a) => a.token !== undefined,
          "login has email": (a) => a.email !== undefined,
        });

        // Test 3: Token Validation
        group("Token Validation", () => {
          const tokenStartTime = Date.now();
          const isValid = authHelper.validateToken(auth.token);
          const tokenDuration = Date.now() - tokenStartTime;

          tokenValidationDuration.add(tokenDuration);

          check(isValid, {
            "token validation successful": (valid) => valid === true,
          });
        });

        // Test 4: Profile Access
        group("Profile Access", () => {
          const response = http.get(`${BASE_URL}/api/auth/profile`, {
            headers: authHelper.getAuthHeaders(auth.token),
          });

          assertions.checkApiResponse(response, 200, {
            "profile has user data": (r) => r.json("user") !== undefined,
            "profile response time < 200ms": (r) => r.timings.duration < 200,
          });
        });

        // Test 5: MFA Setup (optional)
        if (Math.random() > 0.7) {
          // 30% of users test MFA
          group("MFA Setup", () => {
            const mfaStartTime = Date.now();
            const mfaResponse = authHelper.setupMFA(auth.token);
            const mfaDuration = Date.now() - mfaStartTime;

            mfaSetupDuration.add(mfaDuration);

            assertions.checkApiResponse(mfaResponse, 200, {
              "mfa setup has secret": (r) => r.json("secret") !== undefined,
            });
          });
        }

        // Test 6: Rate Limiting
        group("Rate Limiting Test", () => {
          const rateLimitResults = authHelper.testRateLimit("/api/auth/profile", auth.token, 15);

          const rateLimitHit = rateLimitResults.includes(429);
          check(rateLimitHit, {
            "rate limiting is working": (hit) => hit === true,
          });
        });

        // Test 7: OAuth Initiation
        group("OAuth Flow", () => {
          const oauthResponse = authHelper.initiateOAuth("google");

          assertions.checkApiResponse(oauthResponse, [200, 302], {
            "oauth initiation successful": (r) => r.status === 200 || r.status === 302,
          });
        });

        // Test 8: Token Refresh
        group("Token Refresh", () => {
          // For simplicity, we'll just test the endpoint exists
          // In a real scenario, you'd need a valid refresh token
          const refreshResponse = http.post(
            `${BASE_URL}/api/auth/refresh`,
            JSON.stringify({ refreshToken: "dummy-token" }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );

          // We expect this to fail with invalid token, but endpoint should respond
          check(refreshResponse, {
            "refresh endpoint responds": (r) => r.status === 400 || r.status === 401,
            "refresh response time < 200ms": (r) => r.timings.duration < 200,
          });
        });

        // Test 9: Logout
        group("User Logout", () => {
          const logoutResponse = authHelper.logout(auth.token);

          assertions.checkApiResponse(logoutResponse, 200, {
            "logout successful": (r) => r.status === 200,
            "logout response time < 100ms": (r) => r.timings.duration < 100,
          });
        });

        sleep(1);
      } catch (error) {
        authSuccessRate.add(false);
        console.error("Authentication flow failed:", error);
      }
    });
  });

  // Random think time between user actions
  sleep(Math.random() * 2 + 1);
}

export function teardown(data) {
  console.log("Auth flow performance test completed");
  console.log("Test duration:", new Date().toISOString(), "to", data.testStartTime);

  // Final health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  check(healthCheck, {
    "API still healthy after test": (r) => r.status === 200,
  });
}
