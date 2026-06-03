"use client";

/**
 * @file BulkScheduleView.tsx
 * @component BulkScheduleView
 * @description Bulk scheduling interface. The CSV-based 2-phase flow
 *              (parse → channel picker → confirm) is the primary workflow.
 *              The legacy provider-fan-out form has been removed; target
 *              channels are now selected explicitly via the channel picker.
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { CSVBulkUpload } from "@/components/scheduling/CSVBulkUpload";

interface BulkScheduleViewProps {
  /** Required: the active project ID for the channel lookup and API calls. */
  projectId: string;
  /** Optional: default timezone displayed in the upload component. */
  timezone?: string;
}

/**
 * @component BulkScheduleView
 * @description Renders the CSV-based 2-phase bulk scheduling UI:
 *   Step 1 — parse preview (server validates; no DB write).
 *   Step 2 — channel picker + confirm (server persists atomically).
 */
export function BulkScheduleView({ projectId, timezone }: BulkScheduleViewProps) {
  const t = useTranslations("scheduling.components");

  return (
    <div className="space-y-6">
      {/* CSV Bulk Upload — 2-phase flow */}
      <div className="bg-white rounded-lg border p-6">
        <CSVBulkUpload projectId={projectId} {...(timezone !== undefined && { timezone })} />
      </div>

      {/* Templates */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">{t("templatesTitle")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["dailyEngagement", "weeklyDigest", "productLaunch"] as const).map((templateKey) => (
            <div
              key={templateKey}
              className="border rounded-lg p-4 hover:shadow-xs transition-shadow"
            >
              <h4 className="font-medium mb-2">{t(`templates.${templateKey}.name`)}</h4>
              <p className="text-sm text-gray-600 mb-2">
                {t(`templates.${templateKey}.description`)}
              </p>
              <p className="text-xs text-gray-500 mb-3">{t(`templates.${templateKey}.schedule`)}</p>
              <button className="w-full text-blue-600 border border-blue-600 py-2 px-4 rounded-sm hover:bg-blue-50 focus:ring-2 focus:ring-blue-500">
                {t("templatesUse")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
