/**
 * @file LoadingSpinner.tsx
 * @description Accessible loading indicator with ARIA live region.
 *   Uses CSS custom-property tokens for theme support.
 * @layer presentation
 */

import React from "react";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<LoadingSpinnerProps["size"]>, string> = {
  sm: "w-4 h-4 border-2",
  md: "w-8 h-8 border-2",
  lg: "w-12 h-12 border-[3px]",
};

/**
 * @component LoadingSpinner
 * @description Accessible loading indicator with ARIA live region and configurable size.
 * @param props.size - Spinner diameter: "sm", "md", or "lg"
 * @param props.label - Screen-reader label for the loading state
 */
export function LoadingSpinner({
  size = "md",
  label = "Loading...",
  className = "",
}: LoadingSpinnerProps) {
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`${SIZE_CLASSES[size]} border-[var(--accent)] border-t-transparent rounded-full animate-spin`}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
