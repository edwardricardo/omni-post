/**
 * @file VisuallyHidden.tsx
 * @description Screen-reader-only content. Renders children in the DOM but
 *   hides them visually via the standard "sr-only" pattern. The `as` prop
 *   allows the consumer to render a semantic element (e.g. heading).
 * @component VisuallyHidden
 * @layer infrastructure
 */
import type { ElementType, ReactNode } from "react";

interface VisuallyHiddenProps {
  children: ReactNode;
  as?: ElementType;
}

const srOnlyStyle = {
  position: "absolute" as const,
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap" as const,
  border: 0,
};

export function VisuallyHidden({ children, as: Component = "span" }: VisuallyHiddenProps) {
  return (
    <Component className="sr-only" style={srOnlyStyle}>
      {children}
    </Component>
  );
}
