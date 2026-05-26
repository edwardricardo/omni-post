/**
 * @file RoleBadge.tsx
 * @component RoleBadge
 * @description Role badge component for team member display.
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";

const ROLE_STYLES = {
  OWNER: "bg-purple-100 text-purple-700",
  MANAGER: "bg-blue-100 text-blue-700",
  MEMBER: "bg-green-100 text-green-700",
  VIEWER: "bg-gray-100 text-gray-600",
} as const;

export function RoleBadge({ role }: { role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER" }) {
  const t = useTranslations("team");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[role]}`}
    >
      {t(`roles.${role}`)}
    </span>
  );
}
