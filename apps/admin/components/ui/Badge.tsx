/**
 * @file Badge.tsx
 * @description Small pill badge with semantic color variants. Uses CSS
 *              custom-property tokens for full theme support.
 * @layer infrastructure
 */

import React from "react";

interface BadgeProps {
  /** Semantic color variant driving background and text tokens. */
  variant: "success" | "warning" | "error" | "info" | "neutral";
  /** Label or icon content rendered inside the pill. */
  children: React.ReactNode;
  /** Pill density: `sm` for compact rows, `md` for default headers. Defaults to `md`. */
  size?: "sm" | "md";
}

const VARIANT_CLASSES: Record<BadgeProps["variant"], string> = {
  success: "bg-[var(--success-subtle)] text-[var(--success)]",
  warning: "bg-[var(--warning-subtle)] text-[var(--warning)]",
  error: "bg-[var(--error-subtle)] text-[var(--error)]",
  info: "bg-[var(--accent-subtle)] text-[var(--accent)]",
  neutral: "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
};

const SIZE_CLASSES: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "px-1.5 py-px text-[10px]",
  md: "px-1.5 py-px text-[11px]",
};

/**
 * @component Badge
 * @description Small pill badge with semantic color variants for status indication.
 * @param props.variant - Semantic color: "success", "warning", "error", "info", or "neutral"
 * @param props.size - Badge size: "sm" or "md"
 */
export function Badge({ variant, children, size = "md" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full font-medium leading-tight",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
      ].join(" ")}
    >
      {children}
    </span>
  );
}
