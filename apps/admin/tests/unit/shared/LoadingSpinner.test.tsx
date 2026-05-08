/**
 * Unit Tests — LoadingSpinner Component
 *
 * Verifies accessible loading indicator behavior:
 * - ARIA attributes for screen readers
 * - Size variants
 * - Custom labels
 *
 * @file LoadingSpinner.test.tsx
 * @description Tests for LoadingSpinner
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

describe("LoadingSpinner", () => {
  it("renders with default label", () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("has role=status and aria-live=polite", () => {
    render(<LoadingSpinner />);
    const container = screen.getByRole("status");
    expect(container).toHaveAttribute("aria-live", "polite");
  });

  it("renders custom label text", () => {
    render(<LoadingSpinner label="Saving changes..." />);
    expect(screen.getByText("Saving changes...")).toBeInTheDocument();
  });

  it("hides spinner div from screen readers via aria-hidden", () => {
    const { container } = render(<LoadingSpinner />);
    const spinnerDiv = container.querySelector("[aria-hidden='true']");
    expect(spinnerDiv).toBeInTheDocument();
  });

  it("applies sr-only to label span (visually hidden but accessible)", () => {
    const { container } = render(<LoadingSpinner />);
    const labelSpan = container.querySelector(".sr-only");
    expect(labelSpan).toBeInTheDocument();
    expect(labelSpan).toHaveTextContent("Loading...");
  });

  it("applies correct size class for sm", () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const spinner = container.querySelector("[aria-hidden='true']");
    expect(spinner?.className).toContain("w-4");
    expect(spinner?.className).toContain("h-4");
  });

  it("applies correct size class for md (default)", () => {
    const { container } = render(<LoadingSpinner size="md" />);
    const spinner = container.querySelector("[aria-hidden='true']");
    expect(spinner?.className).toContain("w-8");
    expect(spinner?.className).toContain("h-8");
  });

  it("applies correct size class for lg", () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const spinner = container.querySelector("[aria-hidden='true']");
    expect(spinner?.className).toContain("w-12");
    expect(spinner?.className).toContain("h-12");
  });

  it("applies additional className to wrapper", () => {
    const { container } = render(<LoadingSpinner className="my-custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper?.className).toContain("my-custom-class");
  });
});
