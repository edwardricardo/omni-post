/**
 * Client Authentication API
 *
 * All auth calls go through the Next.js backend proxy at /api/backend/
 * which handles httpOnly cookie management. The browser NEVER sees JWTs.
 *
 * - Login:    POST /api/backend/auth/login   -> sets session cookie server-side
 * - Logout:   POST /api/backend/auth/logout  -> clears session cookie server-side
 * - Refresh:  POST /api/backend/auth/refresh -> rotates session cookie server-side
 * - Me:       GET  /api/backend/auth/me      -> proxy injects Bearer from cookie
 *
 * @module lib/auth/authApi
 */

// All requests go through the Next.js proxy -- no direct backend access
const PROXY_BASE = "/api/backend/auth";

export interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
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
      const error = await response.json().catch(() => ({
        message: "An error occurred",
      }));
      throw new Error(error.message || error.error || `HTTP error! status: ${response.status}`);
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
      const error = await response.json().catch(() => ({
        error: "An error occurred",
      }));
      throw new Error(error.error || error.message || `HTTP error! status: ${response.status}`);
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
      throw new Error("Token refresh failed");
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
    const data = (result as any).data ?? result;
    return data.user ?? data;
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
