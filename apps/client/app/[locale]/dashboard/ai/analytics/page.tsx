/**
 * @file page.tsx
 * @description Content intelligence analytics page rendering the PredictiveAnalytics component
 * with data fetched via TanStack Query hooks in usePredictiveData. Server Component —
 * interactive PredictiveAnalytics child owns the client boundary.
 * NOTE: Despite the component name, analytics are rule-based / LLM-assisted, not ML-trained.
 * @layer infrastructure
 */

import { getTranslations } from "next-intl/server";
import PredictiveAnalytics from "@/components/ai/PredictiveAnalytics";
/**
 * @component AIAnalyticsPage
 * @description Displays AI-powered content intelligence analytics with performance insights and trend analysis.
 */
export default async function AIAnalyticsPage() {
  const t = await getTranslations("ai");
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("analytics.title")}</h1>
        <p className="text-gray-600">{t("analytics.subtitle")}</p>
      </div>
      <PredictiveAnalytics />
    </div>
  );
}
