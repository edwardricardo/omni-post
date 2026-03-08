/**
 * Admin Logout Button
 *
 * Renders a form whose action is the logoutAction Server Action.
 * Submitting the form clears the admin-session cookie and redirects
 * to /auth/login — no client-side JavaScript is required.
 */
"use client";

import { logoutAction } from "@/app/actions/auth";

interface LogoutButtonProps {
  className?: string;
  children?: React.ReactNode;
}

export function LogoutButton({ className, children }: LogoutButtonProps) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={className}>
        {children ?? "Logout"}
      </button>
    </form>
  );
}
