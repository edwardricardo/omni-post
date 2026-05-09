/**
 * @file authApi.ts
 * @description Client-side authentication API wrapper — login, logout, refresh, and me operations
 *              routed through the Next.js proxy with httpOnly cookie-based session management.
 *              All failure paths throw `ApiError` so callers can switch on status / code.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";

// All requests go through the Next.js proxy -- no direct backend access
const PROXY_BASE = "/api/backend/auth/customer";

interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
}

async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  return response.json().catch(() => ({}) as ApiErrorBody);
}

function buildApiError(status: number, body: ApiErrorBody, fallback: string): ApiError {
  const message = body.error ?? body.message ?? fallback;
  return new ApiError(status, body.code ?? null, message);
}

export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  /**
   * The customer account this user belongs to. Returned by
   * `GET /auth/customer/me` and required for partitioning queries
   * (projects, channels, posts) per Account in the multi-tenant model.
   */
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

/**
 * Successful auth response from the proxy.
 * Note: accessToken is stripped by the proxy and stored as httpOnly cookie.
 * The client only sees the user data and expiration.
 */
export interface AuthResponse {
  user: User;
  expiresAt: string;
}

export interface MfaChallenge {
  requiresMfa: true;
  message: string;
  methods: string[];
}

export interface RegisterResponse {
  user: User;
}

export interface RefreshResponse {
  expiresAt: string;
}

class AuthAPI {
  /**
   * Generic request helper -- all calls go through the proxy.
   * No Authorization header needed: the proxy reads the httpOnly cookie.
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${PROXY_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw buildApiError(response.status, body, `Request failed (${response.status})`);
    }

    return response.json();
  }

  /**
   * Login with email/password.
   * The proxy intercepts the response, extracts the accessToken,
   * sets it as an httpOnly cookie, and returns user data only.
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse | MfaChallenge> {
    const response = await fetch(`${PROXY_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
      credentials: "include",
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw buildApiError(response.status, body, "Login failed");
    }

    const result = await response.json();

    // The proxy wraps the response in { ok, data }
    const data = result.data ?? result;

    // Check for MFA challenge
    if (data.mfaRequired) {
      return {
        requiresMfa: true,
        message: data.message || "MFA token required",
        methods: data.methods || [],
      };
    }

    return {
      user: data.user,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * Register a new account.
   * The proxy will set session cookies if the backend returns tokens.
   */
  async register(data: RegisterData): Promise<RegisterResponse> {
    return this.request<RegisterResponse>("/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Logout -- the proxy clears all auth cookies server-side.
   * The refresh token is injected by the proxy from its httpOnly cookie.
   */
  async logout(): Promise<void> {
    await fetch(`${PROXY_BASE}/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      credentials: "include",
    });
    // Always consider logout successful from the client perspective
  }

  /**
   * Refresh the session -- the proxy injects the refresh token from cookie
   * and updates the session cookie with the new access token.
   */
  async refreshToken(): Promise<RefreshResponse> {
    const response = await fetch(`${PROXY_BASE}/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      credentials: "include",
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw buildApiError(response.status, body, "Token refresh failed");
    }

    const result = await response.json();
    const data = result.data ?? result;

    return {
      expiresAt: data.expiresAt,
    };
  }

  /**
   * Get the currently authenticated user.
   * The proxy reads the session cookie and injects the Bearer header.
   */
  async getCurrentUser(): Promise<User> {
    const result = await this.request<{ ok: boolean; data: { user: User } }>("/me", {
      method: "GET",
    });

    // Handle both { data: { user } } and { user } response shapes
    const resultObj = result as unknown as Record<string, unknown>;
    const data = (resultObj.data as Record<string, unknown> | undefined) ?? resultObj;
    return (data.user as User | undefined) ?? (data as unknown as User);
  }

  /**
   * Update user profile
   */
  async updateProfile(data: Partial<User>): Promise<User> {
    return this.request<User>("/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /**
   * Change password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.request<void>("/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  /**
   * Request password reset email
   */
  async requestPasswordReset(email: string): Promise<void> {
    return this.request<void>("/reset-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    return this.request<void>("/reset-password/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    return this.request<void>("/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(): Promise<void> {
    return this.request<void>("/verify-email/resend", {
      method: "POST",
    });
  }
}

export const authApi = new AuthAPI();
