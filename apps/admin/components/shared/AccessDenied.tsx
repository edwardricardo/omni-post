/**
 * @file AccessDenied.tsx
 * @description Full-block component for 403 permission denied errors.
 *   Shown in place of page content when a query returns 403.
 * @layer infrastructure
 */
"use client";

import { ShieldOff } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

interface AccessDeniedProps {
  message?: string;
  requiredRole?: string;
}

/**
 * @component AccessDenied
 * @description Full-block 403 permission denied screen with icon, message, and navigation links.
 * @param props.message - Custom error message; falls back to a default i18n string
 * @param props.requiredRole - If provided, displays which role is needed for access
 */
export function AccessDenied({ message, requiredRole }: AccessDeniedProps) {
  const te = useTranslations("errors");

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4"
      role="alert"
    >
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[var(--error-subtle)] text-[var(--error)]">
        <ShieldOff className="h-8 w-8" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          {te("permissionDenied")}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          {message ?? te("permissionDeniedDescription")}
        </p>
        {requiredRole && (
          <p className="text-xs text-[var(--text-tertiary)]">Required role: {requiredRole}</p>
        )}
      </div>

      <div className="flex gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center h-8 px-4 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          {te("goToDashboard")}
        </Link>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex items-center justify-center h-8 px-4 rounded-md text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          {te("goBack")}
        </button>
      </div>
    </div>
  );
}
