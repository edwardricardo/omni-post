/**
 * @file TeamMemberRow.test.tsx
 * @description Security-focused tests for TeamMemberRow role-based access control.
 *              Verifies that only OWNER can manage roles and remove members,
 *              and that self-management is correctly prevented.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamMemberRow } from "./TeamMemberRow";
import { IntlTestProvider } from "../../tests/intl-test-utils";
import type { TeamMemberDto } from "@/hooks/api/useTeam";

vi.mock("@packages/ui", () => ({
  Button: ({
    children,
    onClick,
    title,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} title={title} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("lucide-react", () => ({
  Trash2: ({ className }: { className?: string }) => (
    <svg data-testid="trash-icon" className={className} />
  ),
}));

vi.mock("./RoleBadge", () => ({
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}));

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------
const makeMember = (overrides?: Partial<TeamMemberDto>): TeamMemberDto => ({
  id: "member-001",
  accountId: "account-001",
  email: "alice@example.com",
  name: "Alice Johnson",
  role: "MEMBER",
  isActive: true,
  joinedAt: "2025-06-15T00:00:00Z",
  createdAt: "2025-06-15T00:00:00Z",
  ...overrides,
});

const CURRENT_USER_ID = "current-user-001";

describe("TeamMemberRow", () => {
  const onUpdateRole = vi.fn();
  const onRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. OWNER sees role select for non-OWNER members
  // -----------------------------------------------------------------------
  describe("OWNER permissions", () => {
    it("shows role select when current user is OWNER and member is not OWNER", () => {
      const member = makeMember({ role: "MEMBER" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="OWNER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
      expect(select).toHaveValue("MEMBER");
    });

    // -----------------------------------------------------------------------
    // 2. OWNER sees remove button for other members
    // -----------------------------------------------------------------------
    it("shows remove button when current user is OWNER and member is not self", () => {
      const member = makeMember();

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="OWNER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      const removeButton = screen.getByTitle("Eliminar");
      expect(removeButton).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // 3. OWNER does not see role select for self
    // -----------------------------------------------------------------------
    it("does not show role select when member is the current user", () => {
      const member = makeMember({ id: CURRENT_USER_ID, role: "OWNER" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="OWNER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // 4. OWNER does not see remove button for self
    // -----------------------------------------------------------------------
    it("does not show remove button when member is the current user", () => {
      const member = makeMember({ id: CURRENT_USER_ID, role: "OWNER" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="OWNER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByTitle("Eliminar")).not.toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // 5. OWNER does not see role select for another OWNER
    // -----------------------------------------------------------------------
    it("does not show role select when target member is also OWNER", () => {
      const member = makeMember({ id: "other-owner", role: "OWNER" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="OWNER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.getByTestId("role-badge")).toHaveTextContent("OWNER");
    });
  });

  // -----------------------------------------------------------------------
  // 6-7. MANAGER cannot change role or remove
  // -----------------------------------------------------------------------
  describe("MANAGER permissions", () => {
    it("does not show role select for MANAGER user", () => {
      const member = makeMember();

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="MANAGER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("does not show remove button for MANAGER user", () => {
      const member = makeMember();

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="MANAGER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByTitle("Eliminar")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 8-9. MEMBER cannot change role or remove
  // -----------------------------------------------------------------------
  describe("MEMBER permissions", () => {
    it("does not show role select for MEMBER user", () => {
      const member = makeMember({ id: "other-member" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="MEMBER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("does not show remove button for MEMBER user", () => {
      const member = makeMember({ id: "other-member" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="MEMBER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByTitle("Eliminar")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 10-11. VIEWER cannot change role or remove
  // -----------------------------------------------------------------------
  describe("VIEWER permissions", () => {
    it("does not show role select for VIEWER user", () => {
      const member = makeMember({ id: "some-member" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="VIEWER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("does not show remove button for VIEWER user", () => {
      const member = makeMember({ id: "some-member" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="VIEWER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.queryByTitle("Eliminar")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 12. Displays member name and email
  // -----------------------------------------------------------------------
  describe("display", () => {
    it("shows member name and email", () => {
      const member = makeMember({ name: "Bob Smith", email: "bob@example.com" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="VIEWER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------
    // 13. Displays role badge for non-editable roles
    // -----------------------------------------------------------------------
    it("shows role badge when role is not editable", () => {
      const member = makeMember({ role: "MANAGER" });

      render(
        <IntlTestProvider>
          <TeamMemberRow
            member={member}
            currentUserRole="MANAGER"
            currentUserId={CURRENT_USER_ID}
            onUpdateRole={onUpdateRole}
            onRemove={onRemove}
          />
        </IntlTestProvider>
      );

      const badge = screen.getByTestId("role-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("MANAGER");
    });
  });
});
