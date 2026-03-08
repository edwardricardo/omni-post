import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { randomString } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

// Shared test data
const testUsers = new SharedArray("test-users", function () {
  return [
    { email: "perf-test-1@example.com", password: "TestPassword123!" },
    { email: "perf-test-2@example.com", password: "TestPassword123!" },
    { email: "perf-test-3@example.com", password: "TestPassword123!" },
    { email: "perf-test-4@example.com", password: "TestPassword123!" },
    { email: "perf-test-5@example.com", password: "TestPassword123!" },
  ];
});

export class AuthHelper {
  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl;
    this.tokens = new Map();
  }

  /**
   * Create a test user account
   */
  createTestUser(userIndex = 0) {
    const user = testUsers[userIndex % testUsers.length];
    const uniqueEmail = `perf-${Date.now()}-${randomString(8)}@example.com`;

    const payload = {
      email: uniqueEmail,
      name: `Performance Test User ${userIndex}`,
      password: user.password,
    };

    const response = http.post(`${this.baseUrl}/api/auth/register`, JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });

    const success = check(response, {
      "user creation status is 201": (r) => r.status === 201,
      "user creation has token": (r) => r.json("token") !== undefined,
    });

    if (success && response.json("token")) {
      return {
        email: uniqueEmail,
        password: user.password,
        token: response.json("token"),
        userId: response.json("user.id"),
      };
    }

    throw new Error(`Failed to create test user: ${response.status} - ${response.body}`);
  }

  /**
   * Login with existing credentials
   */
  login(email, password) {
    const payload = {
      email,
      password,
    };

    const response = http.post(`${this.baseUrl}/api/auth/login`, JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });

    const success = check(response, {
      "login status is 200": (r) => r.status === 200,
      "login has token": (r) => r.json("token") !== undefined,
    });

    if (success) {
      const token = response.json("token");
      this.tokens.set(email, token);
      return {
        token,
        user: response.json("user"),
      };
    }

    throw new Error(`Login failed: ${response.status} - ${response.body}`);
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Login or use cached token
   */
  authenticate(userIndex = 0) {
    const user = testUsers[userIndex % testUsers.length];

    if (this.tokens.has(user.email)) {
      return {
        token: this.tokens.get(user.email),
        email: user.email,
      };
    }

    const authResult = this.login(user.email, user.password);
    return {
      token: authResult.token,
      email: user.email,
      user: authResult.user,
    };
  }

  /**
   * Test JWT token validation
   */
  validateToken(token) {
    const response = http.get(`${this.baseUrl}/api/auth/profile`, {
      headers: this.getAuthHeaders(token),
    });

    return check(response, {
      "token validation status is 200": (r) => r.status === 200,
      "token validation has user data": (r) => r.json("user") !== undefined,
    });
  }

  /**
   * OAuth flow simulation (simplified)
   */
  initiateOAuth(provider = "google") {
    const response = http.get(`${this.baseUrl}/api/auth/oauth/${provider}`);

    check(response, {
      "oauth initiation redirects": (r) => r.status === 302 || r.status === 200,
    });

    return response;
  }

  /**
   * Refresh token
   */
  refreshToken(refreshToken) {
    const payload = {
      refreshToken,
    };

    const response = http.post(`${this.baseUrl}/api/auth/refresh`, JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });

    check(response, {
      "token refresh status is 200": (r) => r.status === 200,
      "token refresh has new token": (r) => r.json("token") !== undefined,
    });

    return response;
  }

  /**
   * Logout
   */
  logout(token) {
    const response = http.post(`${this.baseUrl}/api/auth/logout`, null, {
      headers: this.getAuthHeaders(token),
    });

    check(response, {
      "logout status is 200": (r) => r.status === 200,
    });

    return response;
  }

  /**
   * MFA setup simulation
   */
  setupMFA(token) {
    // Enable MFA
    const enableResponse = http.post(`${this.baseUrl}/api/auth/mfa/enable`, null, {
      headers: this.getAuthHeaders(token),
    });

    check(enableResponse, {
      "mfa enable status is 200": (r) => r.status === 200,
      "mfa setup has secret": (r) => r.json("secret") !== undefined,
    });

    if (enableResponse.status === 200) {
      // Verify MFA with dummy TOTP
      const verifyPayload = {
        token: "123456", // Dummy TOTP for testing
      };

      const verifyResponse = http.post(
        `${this.baseUrl}/api/auth/mfa/verify`,
        JSON.stringify(verifyPayload),
        {
          headers: this.getAuthHeaders(token),
        }
      );

      check(verifyResponse, {
        "mfa verify attempted": (r) => r.status === 200 || r.status === 400,
      });
    }

    return enableResponse;
  }

  /**
   * Rate limiting test
   */
  testRateLimit(endpoint = "/api/auth/profile", token, maxRequests = 10) {
    const results = [];

    for (let i = 0; i < maxRequests; i++) {
      const response = http.get(`${this.baseUrl}${endpoint}`, {
        headers: this.getAuthHeaders(token),
      });

      results.push(response.status);

      if (response.status === 429) {
        // Rate limit hit
        break;
      }

      sleep(0.1); // Small delay between requests
    }

    return results;
  }
}

export function createAuthenticatedUser(authHelper, userIndex = 0) {
  try {
    return authHelper.authenticate(userIndex);
  } catch (error) {
    console.error(`Authentication failed for user ${userIndex}:`, error);
    // Try creating a new user
    return authHelper.createTestUser(userIndex);
  }
}
