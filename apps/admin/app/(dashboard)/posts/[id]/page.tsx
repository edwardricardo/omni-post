/**
 * @file page.tsx
 * @description Server Component page for displaying a single post's details by ID.
 *              Fetches post data from the backend API and renders details.
 *              Includes "Submit for Review" action for eligible users.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "@/lib/apiClient";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { SubmitForReviewButton } from "@/components/approvals/SubmitForReviewButton";

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  const post = await api
    .getPost(id)
    .catch(() => ({ ok: false, value: null as unknown as { id: string; status?: string } }));
  if (!post.ok) return <div>Error cargando post</div>;
  const p = post.value as { id: string; status?: string; locale?: string; body?: string };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Post {p.id}</h1>
        <SubmitForReviewButton
          postId={p.id}
          postStatus={p.status ?? "DRAFT"}
          submitterId={user.id}
          userRole={user.role}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</p>
          <p className="mt-1 text-sm text-gray-700">{p.status ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Locale</p>
          <p className="mt-1 text-sm text-gray-700">{p.locale ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Body</p>
          <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{p.body ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
