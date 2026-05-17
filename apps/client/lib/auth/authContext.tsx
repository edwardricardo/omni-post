"use client";

/**
 * @file authContext.tsx
 * @description React context providing authentication state derived from the backend session
 *              (cookie-based). Exposes login/logout/register handlers and current user.
 * @component AuthProvider
 * @layer infrastructure
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  authApi,
  type LoginCredentials,
  type RegisterData,
  type MfaChallenge,
  type User,
} from "./authApi";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Logout API call failed — still clear client state
    } finally {
      // Clear client-side state only -- cookies are cleared by the proxy
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  const refreshSession = useCallback(async () => {
    try {
      await authApi.refreshToken();
      // Session cookie is updated by the proxy -- no client-side token storage
    } catch {
      // Refresh failed — session is expired, force logout
      await logout();
    }
  }, [logout]);

  const checkAuth = useCallback(async () => {
    try {
      // Ask the proxy to verify the session cookie with the backend
      const userData = await authApi.getCurrentUser();
      setUser(userData);
    } catch {
      // No valid session -- user is not authenticated
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Periodically refresh the session to keep the access token alive.
  // The access token TTL is typically 15 minutes; refresh every 12 minutes.
  useEffect(() => {
    if (!user) return;

    const REFRESH_INTERVAL = 12 * 60 * 1000; // 12 minutes

    const interval = setInterval(() => {
      refreshSession();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [user, refreshSession]);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      try {
        setError(null);
        setIsLoading(true);

        const response = await authApi.login(credentials);

        // Check if MFA is required
        if ("requiresMfa" in response) {
          const mfaResponse = response as MfaChallenge;
          setError(mfaResponse.message);
          throw new Error(mfaResponse.message);
        }

        // Login successful -- the proxy already set the session cookie.
        // Fetch user data to populate the context.
        setUser(response.user);

        // Redirect to dashboard
        router.push("/dashboard");
      } catch (loginError: unknown) {
        setError(loginError instanceof Error ? loginError.message : "Login failed");
        throw loginError;
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  const register = useCallback(
    async (data: RegisterData) => {
      try {
        setError(null);
        setIsLoading(true);

        await authApi.register(data);

        // Auto-login after registration
        await login({
          email: data.email,
          password: data.password,
        });
      } catch (registerError: unknown) {
        setError(registerError instanceof Error ? registerError.message : "Registration failed");
        throw registerError;
      } finally {
        setIsLoading(false);
      }
    },
    [login]
  );

  const value: AuthContextType = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      refreshSession,
      error,
    }),
    [user, isLoading, login, register, logout, refreshSession, error]
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
