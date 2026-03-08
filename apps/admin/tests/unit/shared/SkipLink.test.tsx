/**
 * Unit Tests — SkipLink Component
 *
 * Verifies the "Skip to main content" keyboard navigation component:
 * - Renders with correct href and text
 * - Shows/hides on focus/blur (position style)
 * - WCAG 2.1 compliance (bypass navigation block)
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkipLink } from "@/components/shared/SkipLink";

describe("SkipLink", () => {
  it("renders with default text", () => {
    render(<SkipLink />);
    expect(screen.getByText("Skip to main content")).toBeInTheDocument();
  });

  it("renders with default href pointing to #main-content", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("renders with custom href", () => {
    render(<SkipLink href="#navigation" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "#navigation");
  });

  it("renders with custom children text", () => {
    render(<SkipLink>Skip navigation</SkipLink>);
    expect(screen.getByText("Skip navigation")).toBeInTheDocument();
  });

  it("starts with position absolute and left=-9999px (hidden)", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link");
    // Initial inline style hides the link off-screen
    expect(link).toHaveStyle({ position: "absolute", left: "-9999px" });
  });

  it("becomes visible on focus (position fixed)", async () => {
    const user = userEvent.setup();
    render(<SkipLink />);
    const link = screen.getByRole("link");

    await user.tab(); // Focus the link
    expect(link).toHaveStyle({ position: "fixed", left: "1rem" });
  });

  it("hides again on blur (position absolute)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <button>Other focusable</button>
      </>
    );

    const link = screen.getByRole("link");

    await user.tab(); // Focus skip link
    expect(link).toHaveStyle({ position: "fixed" });

    await user.tab(); // Move to next element (blur skip link)
    expect(link).toHaveStyle({ position: "absolute", left: "-9999px" });
  });

  it("is a valid link element (role=link)", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("has skip-link class for CSS targeting", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link");
    expect(link).toHaveClass("skip-link");
  });
});
