/**
 * @file page.tsx
 * @description Social Inbox page at /admin/inbox. Server Component wrapper that
 *              reads the current user's ID from the session and passes it to
 *              the client-side InboxLayout.
 * @layer ui
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { InboxLayout } from "@/components/inbox/InboxLayout";

export const metadata = {
  title: "Social Inbox — OmniPost Admin",
};

export default async function InboxPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  return (
    <div className="-mx-4 -my-8 sm:-mx-6 lg:-mx-8">
      <InboxLayout userId={user.id} />
    </div>
  );
}
