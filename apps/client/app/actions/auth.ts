"use server";

/**
 * @file auth.ts
 * @description Next.js server actions for client authentication (login, logout, register)
 *              using React 19 Server Actions and httpOnly cookie-based session management.
 * @layer infrastructure
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

const log = new ConsoleLoggerAdapter("client.auth-actions", { alwaysEmit: true });

// Action state type
export interface AuthActionState {
  error?: string;
}

/**
 * Server Action for user login
 * Uses React 19 Server Actions pattern with Next.js 15 async cookies
 */
export async function loginAction(
  prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const rememberMe = formData.get("rememberMe") === "on";

  // Validation
  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  try {
    // Call backend API
    const apiUrl = process.env.API_URL || "http://localhost:3000";
    const response = await fetch(`${apiUrl}/auth/customer/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, rememberMe }),
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Login failed" }));
      return {
        error: errorData.error || errorData.message || "Invalid credentials",
      };
    }

    const data = await response.json();

    // Extract access token from response
    const accessToken = data.data?.accessToken || data.accessToken;

    if (!accessToken) {
      return { error: "Authentication failed - no token received" };
    }

    // Set session cookie (Next.js 15 - async cookies)
    const cookieStore = await cookies();
    cookieStore.set("customer-session", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60, // 30 days or 1 day
      path: "/",
    });

    // Redirect is handled outside try/catch
  } catch (error) {
    log.error("Login failed", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect to dashboard on success
  redirect("/dashboard");
}

/**
 * Server Action for user registration
 * Auto-logs in user after successful registration
 */
export async function registerAction(
  prevState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;
  const name = formData.get("name") as string;

  // Validation
  if (!email || !password || !confirmPassword || !name) {
    return { error: "All fields are required" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long" };
  }

  try {
    const apiUrl = process.env.API_URL || "http://localhost:3000";

    // Derive customer registration fields from the name
    const firstName = name.split(" ")[0] || name;
    const lastName = name.split(" ").slice(1).join(" ") || name;

    // Register customer user
    const registerResponse = await fetch(`${apiUrl}/auth/customer/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountName: name,
        accountEmail: email,
        firstName,
        lastName,
        email,
        password,
      }),
      credentials: "include",
    });

    if (!registerResponse.ok) {
      const errorData = await registerResponse
        .json()
        .catch(() => ({ error: "Registration failed" }));
      return {
        error: errorData.error || errorData.message || "Failed to create account",
      };
    }

    // Auto-login after registration
    const loginResponse = await fetch(`${apiUrl}/auth/customer/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, rememberMe: false }),
      credentials: "include",
    });

    if (!loginResponse.ok) {
      return {
        error: "Account created but login failed. Please try logging in manually.",
      };
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.data?.accessToken || loginData.accessToken;

    if (!accessToken) {
      return { error: "Account created but authentication failed" };
    }

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set("customer-session", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 1 day
      path: "/",
    });
  } catch (error) {
    log.error("Registration failed", error);
    return {
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }

  // Redirect to dashboard on success
  redirect("/dashboard");
}
