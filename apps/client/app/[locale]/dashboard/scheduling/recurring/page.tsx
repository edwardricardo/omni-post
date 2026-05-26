/**
 * @file page.tsx
 * @component RecurringPostsPage
 * @description Recurring posts list page — shows all recurring posts for the active project
 * with human-readable cron schedule, status badges, and deactivate action.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useProject } from "@/providers/ProjectProvider";
import { RecurringPostsList } from "@/components/scheduling/RecurringPostsList";

export default function RecurringPostsPage() {
  const t = useTranslations("scheduling");
  const { projectId } = useProject();

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("recurringListTitle")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("recurringListSubtitle")}</p>
        </div>
        <Link
          href="/dashboard/scheduling/recurring/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {t("recurringNewButton")}
        </Link>
      </div>

      <RecurringPostsList projectId={projectId} />
    </div>
  );
}
