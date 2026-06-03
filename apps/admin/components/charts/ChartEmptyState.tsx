/**
 * @file ChartEmptyState.tsx
 * @description Placeholder shown inside chart containers when there is no data
 *   to render. Displays an icon and a configurable message.
 * @layer infrastructure
 */
"use client";

import { AlertCircle } from "lucide-react";

interface ChartEmptyStateProps {
  /** Text displayed below the icon. */
  message: string;
  /** Container height in pixels matching the empty chart slot. Defaults to 200. */
  height?: number;
}

/**
 * @component ChartEmptyState
 * @description Placeholder shown inside chart containers when there is no data to render.
 * @param props.message - Text displayed below the icon
 * @param props.height - Container height in pixels, defaults to 200
 */
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
