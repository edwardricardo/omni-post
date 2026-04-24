/**
 * @file page.tsx
 * @description Performance insights page rendering the PerformanceInsights component
 * with project-level defaults for cross-platform content analysis. Server Component —
 * only the interactive analytics child needs the client boundary.
 * @layer infrastructure
 */

import { PerformanceInsights } from "@/components/analytics/PerformanceInsights";
/**
 * @component PerformanceInsightsPage
 * @description Renders cross-platform content performance analysis and insights for all connected social platforms.
 */
export default function PerformanceInsightsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Performance Insights</h1>
        <p className="text-gray-600">Cross-platform content performance analysis and insights</p>
      </div>
      <PerformanceInsights
        accountId=""
        projectId=""
        timeRange="30d"
        platforms={["instagram", "x", "facebook", "linkedin", "tiktok"]}
      />
    </div>
  );
}
