/**
 * @file DashboardLayoutAISubMenu.integration.test.tsx
 * @description Integration tests for the dashboard sidebar's AI
 *              sub-menu: renders 6 sub-entries (Generate, Trends,
 *              Repurpose, Optimizer, Templates, AI Analytics),
 *              auto-expands when the route starts with `/dashboard/ai/`,
 *              toggles manually on button click, and exposes
 *              `aria-expanded` on the toggle for assistive tech.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/auth/authContext", () => ({
  useAuth: () => ({ user: { name: "Test", email: "t@test.com" }, logout: () => Promise.resolve() }),
}));

vi.mock("@/providers/ProjectProvider", () => ({
  ProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/announcements/AnnouncementBanner", () => ({
  AnnouncementBanner: () => null,
}));

vi.mock("@/components/notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// Minimal @packages/ui surface used by DashboardLayout.
vi.mock("@packages/ui", () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarInitial: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

import DashboardLayout from "../../app/dashboard/layout";

beforeEach(() => {
  mockPathname = "/dashboard";
});

function renderLayout() {
  return render(
    <DashboardLayout>
      <div>child</div>
    </DashboardLayout>
  );
}

describe("DashboardLayout — AI sub-menu", () => {
  it("renders the AI group with the chevron-right glyph (collapsed by default on non-AI routes)", () => {
    mockPathname = "/dashboard";

    renderLayout();

    const toggle = screen.getByRole("button", { name: /^AI/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("auto-expands the AI group when the route starts with /dashboard/ai/", () => {
    mockPathname = "/dashboard/ai/trends";

    renderLayout();

    const toggle = screen.getByRole("button", { name: /^AI/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders all 6 AI sub-entries with the correct hrefs once expanded", () => {
    mockPathname = "/dashboard/ai/trends";

    renderLayout();

    const expectedSubEntries: ReadonlyArray<[string, string]> = [
      ["Generate", "/dashboard/ai/generate"],
      ["Trends", "/dashboard/ai/trends"],
      ["Repurpose", "/dashboard/ai/repurpose"],
      ["Optimizer", "/dashboard/ai/optimizer"],
      ["Templates", "/dashboard/ai/templates"],
      ["AI Analytics", "/dashboard/ai/analytics"],
    ];

    for (const [name, href] of expectedSubEntries) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("toggles aria-expanded on the toggle button when clicked", () => {
    mockPathname = "/dashboard";

    renderLayout();

    const toggle = screen.getByRole("button", { name: /^AI/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("hides sub-entries when the group is collapsed", () => {
    mockPathname = "/dashboard";

    renderLayout();

    expect(screen.queryByRole("link", { name: "Trends" })).not.toBeInTheDocument();
  });
});
