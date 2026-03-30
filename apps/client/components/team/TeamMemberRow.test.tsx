/**
 * @file TeamMemberRow.test.tsx
 * @description Tests for TeamMemberRow role-based action visibility.
 * @layer test
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock @packages/ui to avoid monorepo path resolution issues
vi.mock("@packages/ui", () => ({
  Button: ({ children, ...props }: Record<string, unknown>) => {
    const { variant: _v, size: _s, ...htmlProps } = props;
    return (
      <button {...(htmlProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children as React.ReactNode}
      </button>
    );
  },
}));

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Trash2: () => <span data-testid="trash-icon" />,
}));

// Mock RoleBadge
vi.mock("./RoleBadge", () => ({
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}));

import { TeamMemberRow } from "./TeamMemberRow";

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    accountId: "acc-1",
    email: "alice@example.com",
    name: "Alice Smith",
    role: "MEMBER" as const,
    isActive: true,
    joinedAt: "2026-01-15T00:00:00Z",
    createdAt: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

const defaultProps = {
  member: makeMember(),
  currentUserId: "current-user",
  currentUserRole: "OWNER" as const,
  onUpdateRole: vi.fn(),
  onRemove: vi.fn(),
};

describe("TeamMemberRow — role-based action visibility", () => {
  describe("when current user is OWNER", () => {
    it("shows role select for a MEMBER", () => {
      const { container } = render(<TeamMemberRow {...defaultProps} currentUserRole="OWNER" />);
      const select = container.querySelector("select");
      expect(select).toBeTruthy();
    });

    it("shows remove button for a MEMBER", () => {
      render(<TeamMemberRow {...defaultProps} currentUserRole="OWNER" />);
      const removeBtn = screen.queryByTitle("Remove");
      expect(removeBtn).toBeTruthy();
    });

    it("does NOT show remove button for self", () => {
      render(
        <TeamMemberRow
          {...defaultProps}
          currentUserRole="OWNER"
          currentUserId="member-1"
          member={makeMember({ id: "member-1" })}
        />
      );
      const removeBtn = screen.queryByTitle("Remove");
      expect(removeBtn).toBeNull();
    });

    it("does NOT show role select for another OWNER", () => {
      const { container } = render(
        <TeamMemberRow
          {...defaultProps}
          currentUserRole="OWNER"
          member={makeMember({ role: "OWNER" })}
        />
      );
      const select = container.querySelector("select");
      expect(select).toBeNull();
    });
  });

  describe("when current user is MANAGER", () => {
    it("does NOT show role select", () => {
      const { container } = render(<TeamMemberRow {...defaultProps} currentUserRole="MANAGER" />);
      expect(container.querySelector("select")).toBeNull();
    });

    it("does NOT show remove button", () => {
      render(<TeamMemberRow {...defaultProps} currentUserRole="MANAGER" />);
      expect(screen.queryByTitle("Remove")).toBeNull();
    });
  });

  describe("when current user is MEMBER", () => {
    it("does NOT show role select", () => {
      const { container } = render(<TeamMemberRow {...defaultProps} currentUserRole="MEMBER" />);
      expect(container.querySelector("select")).toBeNull();
    });

    it("does NOT show remove button", () => {
      render(<TeamMemberRow {...defaultProps} currentUserRole="MEMBER" />);
      expect(screen.queryByTitle("Remove")).toBeNull();
    });
  });

  describe("when current user is VIEWER", () => {
    it("does NOT show role select", () => {
      const { container } = render(<TeamMemberRow {...defaultProps} currentUserRole="VIEWER" />);
      expect(container.querySelector("select")).toBeNull();
    });

    it("does NOT show remove button", () => {
      render(<TeamMemberRow {...defaultProps} currentUserRole="VIEWER" />);
      expect(screen.queryByTitle("Remove")).toBeNull();
    });
  });

  describe("member info display", () => {
    it("shows member name", () => {
      render(<TeamMemberRow {...defaultProps} />);
      expect(screen.getByText(/Alice Smith/)).toBeTruthy();
    });

    it("shows member email", () => {
      render(<TeamMemberRow {...defaultProps} />);
      expect(screen.getByText("alice@example.com")).toBeTruthy();
    });

    it("shows (you) label for self", () => {
      render(
        <TeamMemberRow
          {...defaultProps}
          currentUserId="member-1"
          member={makeMember({ id: "member-1" })}
        />
      );
      expect(screen.getByText("(you)")).toBeTruthy();
    });
  });
});
