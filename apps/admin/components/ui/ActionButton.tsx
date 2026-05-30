/**
 * @file ActionButton.tsx
 * @description Themed action button with primary, secondary, and danger variants,
 *              three sizes, and a loading state. Uses CSS custom-property tokens.
 * @layer infrastructure
 */
"use client";

import React from "react";

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style mapping to the theme tokens. Defaults to `primary`. */
  variant?: "primary" | "secondary" | "danger";
  /** Button height and font size. Defaults to `md`. */
  size?: "sm" | "md" | "lg";
  /** When true, shows a spinner and disables interaction. Defaults to false. */
  loading?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ActionButtonProps["variant"]>, string> = {
  primary: ["bg-[var(--accent)] text-[var(--accent-fg)]", "hover:bg-[var(--accent-hover)]"].join(
    " "
  ),
  secondary: [
    "bg-[var(--bg-elevated)] text-[var(--text-primary)]",
    "border border-[var(--border-default)]",
    "hover:bg-[var(--bg-overlay)]",
  ].join(" "),
  danger: [
    "bg-[var(--error-subtle)] text-[var(--error)]",
    "hover:bg-[var(--error)] hover:text-white",
  ].join(" "),
};

const SIZE_CLASSES: Record<NonNullable<ActionButtonProps["size"]>, string> = {
  sm: "h-6 px-2 text-[11px]",
  md: "h-7 px-2.5 text-xs",
  lg: "h-8 px-3 text-sm",
};

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * @component ActionButton
 * @description Themed button with primary, secondary, and danger variants, three sizes,
 *   and a loading spinner state. Uses CSS custom-property design tokens.
 * @param props.variant - Visual style: "primary", "secondary", or "danger"
 * @param props.size - Button size: "sm", "md", or "lg"
 * @param props.loading - When true, shows a spinner and disables the button
 */
export function ActionButton({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...rest
}: ActionButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isDisabled ? "cursor-not-allowed opacity-50" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
