"use client";

/**
 * SkipLink Component
 *
 * Provides a "Skip to main content" link for keyboard users.
 * Hidden until focused, allows users to bypass navigation.
 *
 * WCAG 2.1 Success Criterion 2.4.1 (Level A)
 */

import React from "react";

interface SkipLinkProps {
  href?: string;
  children?: React.ReactNode;
}

export function SkipLink({
  href = "#main-content",
  children = "Skip to main content",
}: SkipLinkProps) {
  return (
    <a
      href={href}
      className="skip-link sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:shadow-lg"
      style={{
        position: "absolute",
        left: "-9999px",
      }}
      onFocus={(e) => {
        e.currentTarget.style.position = "fixed";
        e.currentTarget.style.left = "1rem";
        e.currentTarget.style.top = "1rem";
      }}
      onBlur={(e) => {
        e.currentTarget.style.position = "absolute";
        e.currentTarget.style.left = "-9999px";
      }}
    >
      {children}
    </a>
  );
}
