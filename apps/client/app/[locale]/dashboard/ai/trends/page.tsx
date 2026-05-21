"use client";

/**
 * @file page.tsx
 * @description Trend Radar page: shows multi-source scored trending topics
 *              with provenance per row (Perplexity web, account analytics,
 *              inbox mentions), grouped by urgency. Read-only — the
 *              TREND_RADAR worker populates the data on a daily schedule.
 * @component TrendsPage
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Badge, Card, CardContent } from "@packages/ui";
import { BarChart3, ExternalLink, Globe, MessageCircle, Sparkles, TrendingUp } from "lucide-react";
import { useTrendRadar, type ScoredTrend } from "@/hooks/api/useTrendRadar";

const URGENCY_STYLES: Record<ScoredTrend["urgency"], string> = {
  NOW: "bg-red-100 text-red-700",
  TODAY: "bg-yellow-100 text-yellow-700",
  THIS_WEEK: "bg-green-100 text-green-700",
};

const URGENCY_LABEL_KEY: Record<ScoredTrend["urgency"], string> = {
  NOW: "trends.urgencyNow",
  TODAY: "trends.urgencyToday",
  THIS_WEEK: "trends.urgencyThisWeek",
};

const SOURCE_LABEL_KEY: Record<ScoredTrend["source"], string> = {
  PERPLEXITY_WEB: "trends.sourceWeb",
  ACCOUNT_ANALYTICS: "trends.sourceYourPosts",
  INBOX_MENTIONS: "trends.sourceInbox",
};

const SOURCE_ICON: Record<ScoredTrend["source"], typeof Globe> = {
  PERPLEXITY_WEB: Globe,
  ACCOUNT_ANALYTICS: BarChart3,
  INBOX_MENTIONS: MessageCircle,
};

function SourceBadge({ trend }: { trend: ScoredTrend }) {
  const t = useTranslations("ai");
  const Icon = SOURCE_ICON[trend.source];
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{t(SOURCE_LABEL_KEY[trend.source])}</span>
    </Badge>
  );
}

function TrendCard({ trend }: { trend: ScoredTrend }) {
  const t = useTranslations("ai");
  const stars = Math.max(1, Math.round(trend.relevanceScore / 2));
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{trend.topic}</h3>
            {trend.sourceUrl ? (
              <a
                href={trend.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("trends.openSourceLabel", { topic: trend.topic })}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <div
            className="flex items-center gap-1"
            aria-label={t("trends.relevanceLabel", { score: trend.relevanceScore })}
          >
            {Array.from({ length: stars }).map((_, i) => (
              <span key={i} className="text-yellow-500 text-xs">
                &#9733;
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
          <SourceBadge trend={trend} />
          <span>{trend.platform}</span>
          {trend.volume !== null ? (
            <span>{t("trends.postCount", { count: trend.volume })}</span>
          ) : null}
        </div>

        {trend.postIdea ? (
          <div className="mt-2 p-2 rounded bg-muted/50 text-sm flex items-start gap-2">
            <Sparkles className="h-3 w-3 mt-0.5 text-primary flex-shrink-0" aria-hidden="true" />
            <span>{trend.postIdea}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * @component TrendsPage
 * @description Renders the account's trend radar grouped by urgency. The
 *   TREND_RADAR worker scans Perplexity web search, the account's own
 *   analytics, and inbound inbox mentions; this page surfaces the scored
 *   topics with provenance so the user can act on the freshest signals.
 */
export default function TrendsPage() {
  const t = useTranslations("ai");
  const { data, isLoading, error } = useTrendRadar();
  const trends: ScoredTrend[] = data?.scored ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("trends.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("trends.subtitle")}</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <TrendingUp className="h-3 w-3" aria-hidden="true" />
          <span>{t("trends.activeCount", { count: trends.length })}</span>
        </Badge>
      </div>

      {isLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">
          {t("trends.loading")}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive"
        >
          <p className="text-base font-semibold">{t("trends.loadErrorTitle")}</p>
          <p className="mt-2 text-sm">
            {error instanceof Error ? error.message : t("trends.tryAgain")}
          </p>
        </div>
      ) : trends.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">{t("trends.emptyTitle")}</p>
          <p className="text-sm mt-1">{t("trends.emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["NOW", "TODAY", "THIS_WEEK"] as const).map((urgency) => {
            const items = trends.filter((trend) => trend.urgency === urgency);
            if (items.length === 0) return null;
            return (
              <section key={urgency} aria-labelledby={`urgency-${urgency}`}>
                <h2
                  id={`urgency-${urgency}`}
                  className="text-sm font-medium mb-3 flex items-center gap-2"
                >
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_STYLES[urgency]}`}
                  >
                    {t(URGENCY_LABEL_KEY[urgency])}
                  </span>
                  <span className="text-muted-foreground">({items.length})</span>
                </h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  {items.map((trend) => (
                    <TrendCard key={`${trend.source}-${trend.topic}`} trend={trend} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
