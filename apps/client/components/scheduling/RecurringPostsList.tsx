/**
 * @file RecurringPostsList.tsx
 * @component RecurringPostsList
 * @description List of recurring posts with empty/loading/error states and deactivate action.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRecurringPosts, useDeactivateRecurringPost } from "@/hooks/api/useRecurringPosts";
import { RecurringPostCard } from "./RecurringPostCard.js";

interface RecurringPostsListProps {
  projectId?: string;
}

export function RecurringPostsList({ projectId }: RecurringPostsListProps) {
  const t = useTranslations("scheduling.components");
  const { data: posts, isLoading, isError, refetch } = useRecurringPosts({ projectId });
  const deactivate = useDeactivateRecurringPost();

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-sm text-red-700">{t("recurringListError")}</p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-sm font-medium text-red-600 underline hover:no-underline"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 py-16 text-center">
        <p className="text-gray-500">{t("recurringListEmpty")}</p>
        <Link
          href="/dashboard/scheduling/recurring/new"
          className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("recurringListCreateFirst")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <RecurringPostCard
          key={post.id}
          post={post}
          onDeactivate={(id) => deactivate.mutate(id)}
          isDeactivating={deactivate.isPending && deactivate.variables === post.id}
        />
      ))}
    </div>
  );
}
