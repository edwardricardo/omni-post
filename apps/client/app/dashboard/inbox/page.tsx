"use client";

/**
 * @file page.tsx
 * @description Social Inbox page at /dashboard/inbox. Client Component that
 *              renders the InboxLayout with the current user's ID from auth context.
 *              Auth is enforced by the dashboard layout — no server-side check needed.
 * @layer ui
 */

import { useAuth } from "@/lib/auth/authContext";
import { InboxLayout } from "@/components/inbox/InboxLayout";

/**
 * @component InboxPage
 * @description Renders the social inbox layout for managing messages and interactions across connected platforms.
 */
export default function InboxPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="-mx-4 -my-8 sm:-mx-6 lg:-mx-8">
      <InboxLayout userId={user.id} />
    </div>
  );
}
