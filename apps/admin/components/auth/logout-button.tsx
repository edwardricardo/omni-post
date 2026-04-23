/**
 * @file logout-button.tsx
 * @description Admin Logout Button using next-intl for localized label.
 * @layer infrastructure
 */
"use client";

import { logoutAction } from "@/app/actions/auth";
import { useTranslations } from "next-intl";

interface LogoutButtonProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * @component LogoutButton
 * @description Renders a form-based logout button that triggers the server-side logout action.
 */
export function LogoutButton({ className, children }: LogoutButtonProps) {
  const t = useTranslations("common");

  return (
    <form action={logoutAction}>
      <button type="submit" className={className}>
        {children ?? t("logout")}
      </button>
    </form>
  );
}
