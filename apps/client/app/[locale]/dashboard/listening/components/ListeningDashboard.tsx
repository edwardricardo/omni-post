/**
 * @file ListeningDashboard.tsx
 * @description Brand-listening dashboard: window selector, Share-of-Voice summary
 *   cards (total / brand / market / SoV + brand share), per-provider SoV chart,
 *   sentiment breakdown chart, and the mention feed. Fetches real data via the
 *   useShareOfVoice / useMentions hooks (through the authenticated proxy).
 * @component ListeningDashboard
 * @layer infrastructure
 */
"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Radio } from "lucide-react";
import { useShareOfVoice, useMentions } from "@/hooks/api/useListening";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { MentionsFeed } from "./MentionsFeed";

const ShareOfVoiceChart = dynamic(
  () => import("./ShareOfVoiceChart").then((m) => m.ShareOfVoiceChart),
  { ssr: false }
);
const SentimentBreakdownChart = dynamic(
  () => import("./SentimentBreakdownChart").then((m) => m.SentimentBreakdownChart),
  { ssr: false }
);

type WindowDays = 7 | 30 | 90;

interface ListeningDashboardProps {
  /** Project to scope the listening data to. */
  projectId: string;
}

/**
 * Renders the brand-listening dashboard for a project.
 */
export function ListeningDashboard({ projectId }: ListeningDashboardProps) {
  const t = useTranslations("listening");
  const [windowDays, setWindowDays] = useState<WindowDays>(30);

  const { since, until } = useMemo(() => {
    const now = new Date();
    return {
      until: now.toISOString(),
      since: new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  }, [windowDays]);

  const sov = useShareOfVoice(projectId, { since, until });
  const mentions = useMentions(projectId, { since, until });

  const isLoading = sov.isLoading || mentions.isLoading;
  const error = sov.error ?? mentions.error;

  const header = (
    <div className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <span className="sr-only">{t("selectWindowAria")}</span>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value) as WindowDays)}
          aria-label={t("selectWindowAria")}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value={7}>{t("last7Days")}</option>
          <option value={30}>{t("last30Days")}</option>
          <option value={90}>{t("last90Days")}</option>
        </select>
      </label>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-7xl">
          {header}
          <div className="flex h-64 items-center justify-center">
            <LoadingSpinner size="lg" label={t("loading")} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isDev = process.env.NODE_ENV === "development";
    const displayMessage = isDev ? error.message || t("loadError") : t("loadErrorRetry");
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-7xl">
          {header}
          <div className="flex h-64 items-center justify-center" role="alert">
            <div className="text-lg text-red-600">{displayMessage}</div>
            <button
              onClick={() => {
                void sov.refetch();
                void mentions.refetch();
              }}
              className="ml-4 rounded-sm bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              aria-label={t("retryAria")}
            >
              {t("retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sovData = sov.data;
  const mentionItems = mentions.data?.items ?? [];

  if (!sovData || sovData.totalCount === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-7xl">
          {header}
          <EmptyState icon={Radio} title={t("emptyTitle")} description={t("emptyDescription")} />
        </div>
      </div>
    );
  }

  const brandShare =
    sovData.totalCount > 0 ? Math.round((sovData.brandCount / sovData.totalCount) * 100) : 0;

  const cards = [
    { label: t("cardTotal"), value: String(sovData.totalCount) },
    { label: t("cardBrand"), value: String(sovData.brandCount) },
    { label: t("cardMarket"), value: String(sovData.marketCount) },
    { label: t("cardSov"), value: `${sovData.sov.toFixed(2)}×` },
    { label: t("cardBrandShare"), value: `${brandShare}%` },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        {header}

        <section
          aria-label={t("summaryAria")}
          className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5"
        >
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{card.value}</p>
            </div>
          ))}
        </section>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("sovChartTitle")}</h2>
            <ShareOfVoiceChart data={sovData.byProvider} />
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("sentimentChartTitle")}</h2>
            <SentimentBreakdownChart data={sovData.bySentiment} />
          </div>
        </div>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("feedTitle")}</h2>
          <MentionsFeed mentions={mentionItems} />
        </section>
      </div>
    </div>
  );
}
