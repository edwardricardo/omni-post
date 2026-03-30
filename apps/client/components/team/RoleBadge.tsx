/**
 * @file RoleBadge.tsx
 * @description Role badge component for team member display.
 * @layer client-components
 */

"use client";

const ROLE_STYLES = {
  OWNER: "bg-purple-100 text-purple-700",
  MANAGER: "bg-blue-100 text-blue-700",
  MEMBER: "bg-green-100 text-green-700",
  VIEWER: "bg-gray-100 text-gray-600",
} as const;

export function RoleBadge({ role }: { role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[role]}`}
    >
      {role}
    </span>
  );
}
