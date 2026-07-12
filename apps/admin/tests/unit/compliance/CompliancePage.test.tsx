/**
 * @file CompliancePage.test.tsx
 * @description Render tests for the compliance dashboard audit tab. Proves the
 *   polymorphic-actor read path: a CUSTOMER actor surfaces its own identity and
 *   an actor-type badge, while an ADMIN actor row renders exactly as it did
 *   before (the do-not-regress guarantee).
 * @layer infrastructure
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// next-intl: identity translator so assertions target stable keys, not copy.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// AccessDenied (imported by the page) pulls `@/i18n/navigation`, whose real
// `next-intl/navigation` → `next/navigation` chain does not resolve from the
// pnpm store under vitest. Mock the app's navigation barrel so the import graph
// loads (AccessDenied is not rendered on the success path anyway).
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children?: ReactNode }) => children,
  redirect: vi.fn(),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  getPathname: () => "/",
}));

// The compliance view is fed by useCompliance; mock it to return pre-mapped
// audit events (the mapper itself is covered in useCompliance.test.tsx).
const mockUseCompliance = vi.fn();
const mockUseComplianceScore = vi.fn();
vi.mock("@/hooks/api/useCompliance", () => ({
  useCompliance: () => mockUseCompliance(),
  useComplianceScore: () => mockUseComplianceScore(),
}));

import Page from "@/app/[locale]/(dashboard)/compliance/page";

const ADMIN_EVENT = {
  id: "e-admin",
  timestamp: "2026-03-01T10:00:00.000Z",
  action: "UPDATE_POST",
  user: "Alice",
  resource: "posts",
  result: "success" as const,
  details: "{}",
  actorType: "ADMIN" as const,
};

const CUSTOMER_EVENT = {
  id: "e-customer",
  timestamp: "2026-03-01T11:00:00.000Z",
  action: "UPDATE_BILLING",
  user: "Jane Doe",
  resource: "billing",
  result: "success" as const,
  details: "{}",
  actorType: "CUSTOMER" as const,
};

function openAuditTab() {
  fireEvent.click(screen.getByRole("tab", { name: "tabs.audit" }));
}

describe("CompliancePage audit tab", () => {
  beforeEach(() => {
    mockUseCompliance.mockReset();
    mockUseComplianceScore.mockReset();
    mockUseComplianceScore.mockReturnValue({ data: undefined });
    mockUseCompliance.mockReturnValue({
      data: { metrics: [], auditLogs: [ADMIN_EVENT, CUSTOMER_EVENT] },
      isLoading: false,
      error: null,
    });
  });

  it("renders a customer actor's identity and an actor-type badge", () => {
    render(<Page />);
    openAuditTab();

    // Customer identity surfaces (mapper resolved it from the customerUser
    // relation — no longer the anonymous "Unknown" null bucket).
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    // Rendered "via actorType": the customer row carries a distinguishing badge.
    expect(screen.getByText("audit.actorTypes.customer")).toBeInTheDocument();
  });

  it("renders an admin actor row identically — no actor-type badge", () => {
    render(<Page />);
    openAuditTab();

    // Admin identity renders exactly as before.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // The actor-type badge is customer-only: an admin row must not gain it, so
    // there is exactly one badge in the tab (the customer row's).
    expect(screen.queryAllByText("audit.actorTypes.customer")).toHaveLength(1);
  });
});
