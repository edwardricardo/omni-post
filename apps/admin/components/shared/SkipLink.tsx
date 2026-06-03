/**
 * @file SkipLink.tsx
 * @description WCAG 2.1 "Skip to main content" link. Hidden off-screen by
 *   default; becomes visible when focused via keyboard (Tab).
 * @component SkipLink
 * @layer infrastructure
 */
"use client";

import { useState, type ReactNode } from "react";

interface SkipLinkProps {
  /** Target anchor for the skip action. Defaults to `#main-content`. */
  href?: string;
  /** Visible link text rendered when focused. Defaults to `Skip to main content`. */
  children?: ReactNode;
}

export function SkipLink({
  href = "#main-content",
  children = "Skip to main content",
}: SkipLinkProps) {
  const [focused, setFocused] = useState(false);

  const style = focused
    ? {
        position: "fixed" as const,
        top: "1rem",
        left: "1rem",
        zIndex: 9999,
        padding: "0.5rem 1rem",
        background: "#000",
        color: "#fff",
      }
    : {
        position: "absolute" as const,
        left: "-9999px",
      };

  return (
    <a
      href={href}
      className="skip-link"
      style={style}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {children}
    </a>
  );
}
