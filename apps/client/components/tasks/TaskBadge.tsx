/**
 * @file TaskBadge.tsx
 * @component TaskBadge
 * @description Priority and status badges for task display.
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";

const PRIORITY_STYLES = {
  LOW: "bg-gray-100 text-gray-700",
  MEDIUM: "bg-blue-100 text-blue-700",
  HIGH: "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
} as const;

const STATUS_STYLES = {
  OPEN: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-600",
} as const;

export function PriorityBadge({ priority }: { priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }) {
  const t = useTranslations("tasks.components");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

export function StatusBadge({
  status,
}: {
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}) {
  const t = useTranslations("tasks.components");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
