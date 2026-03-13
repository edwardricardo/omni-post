/**
 * @file page.tsx
 * @description Approval Queue page at /admin/approvals. Server Component that
 *              verifies the user has an approver role before rendering the queue.
 *              Non-approvers are redirected to /admin/posts.
 * @layer ui
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";

export const metadata = {
  title: "Approval Queue — OmniPost Admin",
};

const APPROVER_ROLES = new Set(["ADMIN", "APPROVER", "SUPER_ADMIN"]);

export default async function ApprovalsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  // Redirect non-approvers
  if (!APPROVER_ROLES.has(user.role.toUpperCase())) {
    redirect("/posts");
  }

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
