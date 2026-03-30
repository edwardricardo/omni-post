/**
 * @file page.tsx
 * @description Content intelligence analytics page rendering the PredictiveAnalytics component
 * with data fetched via TanStack Query hooks in usePredictiveData.
 * NOTE: Despite the component name, analytics are rule-based / LLM-assisted, not ML-trained.
 */
"use client";

import PredictiveAnalytics from "@/components/ai/PredictiveAnalytics";
export default function AIAnalyticsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Content Intelligence</h1>
        <p className="text-gray-600">Performance insights and trend analysis</p>
      </div>
      <PredictiveAnalytics />
    </div>
  );
}
