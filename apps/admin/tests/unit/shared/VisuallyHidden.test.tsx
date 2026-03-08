/**
 * Unit Tests — VisuallyHidden Component
 *
 * Verifies the screen-reader-only component:
 * - Text content is accessible (in DOM)
 * - sr-only class is applied
 * - Inline positioning styles are applied
 * - Custom element tag (as prop) is respected
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisuallyHidden } from "@/components/shared/VisuallyHidden";

describe("VisuallyHidden", () => {
  it("renders children text content", () => {
    render(<VisuallyHidden>Search</VisuallyHidden>);
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("applies sr-only class", () => {
    render(<VisuallyHidden>Hidden text</VisuallyHidden>);
    const element = screen.getByText("Hidden text");
    expect(element).toHaveClass("sr-only");
  });

  it("applies absolute positioning inline style", () => {
    render(<VisuallyHidden>Hidden text</VisuallyHidden>);
    const element = screen.getByText("Hidden text");
    expect(element).toHaveStyle({ position: "absolute" });
  });

  it("renders as span by default", () => {
    const { container } = render(<VisuallyHidden>Label</VisuallyHidden>);
    const element = container.firstChild as HTMLElement;
    expect(element.tagName).toBe("SPAN");
  });

  it("renders as custom element via as prop", () => {
    const { container } = render(<VisuallyHidden as="p">Label</VisuallyHidden>);
    const element = container.firstChild as HTMLElement;
    expect(element.tagName).toBe("P");
  });

  it("renders as h2 when as='h2'", () => {
    const { container } = render(<VisuallyHidden as="h2">Section</VisuallyHidden>);
    const element = container.firstChild as HTMLElement;
    expect(element.tagName).toBe("H2");
  });

  it("clips content via clip style", () => {
    render(<VisuallyHidden>Content</VisuallyHidden>);
    const element = screen.getByText("Content");
    expect(element).toHaveStyle({ clip: "rect(0, 0, 0, 0)" });
  });

  it("has 1px dimensions to keep it in flow but invisible", () => {
    render(<VisuallyHidden>Content</VisuallyHidden>);
    const element = screen.getByText("Content");
    expect(element).toHaveStyle({ width: "1px", height: "1px" });
  });
});
