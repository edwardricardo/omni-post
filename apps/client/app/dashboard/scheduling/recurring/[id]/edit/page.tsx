/**
 * @file page.tsx
 * @component EditRecurringPostPage
 * @description Edit existing recurring post page. Fetches the recurring post by ID and
 * pre-fills the form with existing values.
 * @layer infrastructure
 */
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RecurringPostForm } from "@/components/scheduling/RecurringPostForm";
import type { RecurringPost } from "@/hooks/api/useRecurringPosts";

export default function EditRecurringPostPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: post,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["recurring-post", id],
    queryFn: async (): Promise<RecurringPost> => {
      const response = await fetch(`/api/backend/recurring-posts/${id}`);
      if (!response.ok) throw new Error("Failed to fetch recurring post");
      const data = (await response.json()) as {
        ok: boolean;
        value?: RecurringPost;
        error?: string;
      };
      if (!data.ok || !data.value) throw new Error(data.error ?? "Not found");
      return data.value;
    },
    enabled: !!id,
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/scheduling/recurring" className="text-sm text-gray-500 hover:text-gray-700">
          ← Publicaciones recurrentes
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Editar publicación recurrente</h1>
      </div>

      <div className="max-w-2xl">
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-gray-100" />
            ))}
          </div>
        )}

        {isError && (
          <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            No se pudo cargar la publicación recurrente.
          </p>
        )}

        {post && <RecurringPostForm existing={post} />}
      </div>
    </div>
  );
}
