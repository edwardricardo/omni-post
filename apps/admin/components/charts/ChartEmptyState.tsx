/**
 * @file ChartEmptyState.tsx
 * @description Placeholder shown inside chart containers when there is no data
 *   to render. Displays an icon and a configurable message.
 * @layer presentation
 */
"use client";

import { AlertCircle } from "lucide-react";

interface ChartEmptyStateProps {
  message: string;
  height?: number;
}

export function ChartEmptyState({ message, height = 200 }: ChartEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-[var(--text-tertiary)]"
      style={{ height }}
    >
      <AlertCircle className="h-8 w-8 mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
