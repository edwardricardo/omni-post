/**
 * @file authApi.ts
 * @description Client-side authentication API wrapper — login, logout, refresh, and me operations
 *              routed through the Next.js proxy with httpOnly cookie-based session management.
 *              All failure paths throw `ApiError` so callers can switch on status / code.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type { Problem } from "../api/types";

// All requests go through the Next.js proxy -- no direct backend access
const PROXY_BASE = "/api/backend/auth/customer";

interface LegacyAuthErrorBody {
  error?: string;
  message?: string;
  code?: string;
}

/** A failed response's body: the API's problem body, or a legacy route's body. */
type ApiErrorBody = Problem | LegacyAuthErrorBody;

/** A failed response's body when it is a JSON object; any other body reads as an empty one. */
async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as ApiErrorBody) : {};
}

/**
 * A problem body gives its code and its `detail`; a legacy route's body gives its `error`, else
 * its `message`, else the endpoint's fallback text.
 */
function buildApiError(status: number, body: ApiErrorBody, fallback: string): ApiError {
  if ("detail" in body) {
    return new ApiError(status, body.code, body.detail);
  }
  return new ApiError(status, body.code ?? null, body.error ?? body.message ?? fallback);
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
  /**
   * Opaque step-2 challenge JWT issued by the backend on `mfaRequired`. Sent
   * back verbatim to `POST /auth/customer/login/mfa` to complete the login.
   * Lives in memory/DOM only — never persisted to browser storage.
   */
  challengeToken: string;
  /** Seconds until the challenge token expires (backend-controlled TTL). */
  expiresInSeconds: number;
}

export interface CompleteMfaLoginParams {
  challengeToken: string;
  code: string;
  rememberMe?: boolean;
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
   * @method login
   * @description Login with email/password. The proxy intercepts the response, extracts the
   *   accessToken, sets it as an httpOnly cookie, and returns user data only.
   * @param credentials - The email, the password and whether to remember the session.
   * @returns The user and the session's expiry, or the MFA challenge when a second factor is due.
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
        challengeToken: data.challengeToken,
        expiresInSeconds: data.expiresInSeconds,
      };
    }

    return {
      user: data.user,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * @method completeMfaLogin
   * @description Complete a customer login that required MFA (step 2). POSTs the opaque
   *   challenge token plus the user's TOTP or backup code to the proxy. On success the proxy
   *   strips the tokens into httpOnly cookies and returns user data only — the browser never
   *   sees the JWTs.
   * @param params - The challenge token, the code and whether to remember the session.
   * @returns The user and the session's expiry.
   */
  async completeMfaLogin(params: CompleteMfaLoginParams): Promise<AuthResponse> {
    const response = await fetch(`${PROXY_BASE}/login/mfa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      credentials: "include",
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw buildApiError(response.status, body, "MFA verification failed");
    }

    const result = await response.json();
    const data = result.data ?? result;

    return {
      user: data.user,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * @method register
   * @description Register a new account. The proxy will set session cookies if the backend
   *   returns tokens.
   * @param data - The new account's email, password and name.
   * @returns The registered user.
   */
  async register(data: RegisterData): Promise<RegisterResponse> {
    return this.request<RegisterResponse>("/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * @method logout
   * @description Logout -- the proxy clears all auth cookies server-side. The refresh token is
   *   injected by the proxy from its httpOnly cookie.
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
   * @method refreshToken
   * @description Refresh the session -- the proxy injects the refresh token from cookie and
   *   updates the session cookie with the new access token.
   * @returns The refreshed session's expiry.
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
   * @method getCurrentUser
   * @description Get the currently authenticated user. The proxy reads the session cookie and
   *   injects the Bearer header.
   * @returns The authenticated user.
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
   * @method updateProfile
   * @description Update user profile.
   * @param data - The profile fields to change.
   * @returns The updated user.
   */
  async updateProfile(data: Partial<User>): Promise<User> {
    return this.request<User>("/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /**
   * @method changePassword
   * @description Change password.
   * @param currentPassword - The password the user holds now.
   * @param newPassword - The password that replaces it.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.request<void>("/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  /**
   * @method requestPasswordReset
   * @description Request password reset email.
   * @param email - The address the reset e-mail goes to.
   */
  async requestPasswordReset(email: string): Promise<void> {
    return this.request<void>("/reset-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * @method resetPassword
   * @description Reset password with token.
   * @param token - The reset token the e-mail carried.
   * @param newPassword - The new password.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    return this.request<void>("/reset-password/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
  }

  /**
   * @method verifyEmail
   * @description Verify email with token.
   * @param token - The verification token the e-mail carried.
   */
  async verifyEmail(token: string): Promise<void> {
    return this.request<void>("/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  /**
   * @method resendVerificationEmail
   * @description Resend verification email.
   */
  async resendVerificationEmail(): Promise<void> {
    return this.request<void>("/verify-email/resend", {
      method: "POST",
    });
  }
}

export const authApi = new AuthAPI();
