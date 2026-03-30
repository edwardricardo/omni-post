"use client";

/**
 * @file page.tsx
 * @description Approval Queue page at /dashboard/approvals. Client Component that
 *              renders the approval queue for the current user. Auth is enforced
 *              by the dashboard layout — no server-side check needed.
 * @layer ui
 */

import { useAuth } from "@/lib/auth/authContext";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";

export default function ApprovalsPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Approval Queue</h1>
        <p className="mt-1 text-sm text-gray-600">Posts pending your review.</p>
      </div>
      <ApprovalQueue reviewerId={user.id} />
    </div>
  );
}
