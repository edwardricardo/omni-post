/**
 * VisuallyHidden Component
 *
 * Hides content visually but keeps it accessible to screen readers.
 * Useful for providing context to assistive technologies without cluttering the visual UI.
 *
 * @example
 * <button>
 *   <SearchIcon />
 *   <VisuallyHidden>Search</VisuallyHidden>
 * </button>
 */

import React, { type ElementType } from "react";

interface VisuallyHiddenProps {
  children: React.ReactNode;
  as?: ElementType;
}

export function VisuallyHidden({ children, as: Component = "span" }: VisuallyHiddenProps) {
  const Tag = Component as ElementType;
  return (
    <Tag
      className="sr-only"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        borderWidth: 0,
      }}
    >
      {children}
    </Tag>
  );
}
