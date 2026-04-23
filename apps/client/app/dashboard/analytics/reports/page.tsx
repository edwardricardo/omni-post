/**
 * @file page.tsx
 * @description Scheduled Reports management page — list, create, delete, and manually
 *              trigger scheduled analytics reports.
 *              Requires ?projectId=<uuid> query param to scope reports to a project.
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScheduledReportsList } from "@/components/analytics/ScheduledReportsList";
import { CreateReportForm } from "@/components/analytics/CreateReportForm";

/**
 * @component ScheduledReportsPage
 * @description Manages scheduled analytics reports with list, create, delete, and manual trigger capabilities.
 */
export default function ScheduledReportsPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (!projectId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Scheduled Reports</h1>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3">
            No project selected. Append{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">
              ?projectId=&lt;uuid&gt;
            </code>{" "}
            to the URL to manage reports for a specific project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Scheduled Reports</h1>
            <p className="text-gray-600 mt-2">
              Automate analytics delivery to your team via email on a recurring schedule.
            </p>
          </div>
          <button
            onClick={() => setIsDialogOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Create Report
          </button>
        </div>

        <ScheduledReportsList projectId={projectId} onCreateClick={() => setIsDialogOpen(true)} />

        <CreateReportForm
          projectId={projectId}
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
        />
      </div>
    </div>
  );
}
