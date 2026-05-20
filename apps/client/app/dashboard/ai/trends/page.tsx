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

import { Badge, Card, CardContent } from "@packages/ui";
import { BarChart3, ExternalLink, Globe, MessageCircle, Sparkles, TrendingUp } from "lucide-react";
import { useTrendRadar, type ScoredTrend } from "@/hooks/api/useTrendRadar";

const URGENCY_LABEL: Record<ScoredTrend["urgency"], string> = {
  NOW: "Post Now",
  TODAY: "Today",
  THIS_WEEK: "This Week",
};

const URGENCY_STYLES: Record<ScoredTrend["urgency"], string> = {
  NOW: "bg-red-100 text-red-700",
  TODAY: "bg-yellow-100 text-yellow-700",
  THIS_WEEK: "bg-green-100 text-green-700",
};

interface SourceMeta {
  label: string;
  Icon: typeof Globe;
}

const SOURCE_META: Record<ScoredTrend["source"], SourceMeta> = {
  PERPLEXITY_WEB: { label: "Web", Icon: Globe },
  ACCOUNT_ANALYTICS: { label: "Your posts", Icon: BarChart3 },
  INBOX_MENTIONS: { label: "Inbox", Icon: MessageCircle },
};

function SourceBadge({ trend }: { trend: ScoredTrend }) {
  const meta = SOURCE_META[trend.source];
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <meta.Icon className="h-3 w-3" aria-hidden="true" />
      <span>{meta.label}</span>
    </Badge>
  );
}

function TrendCard({ trend }: { trend: ScoredTrend }) {
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
                aria-label={`Open source for ${trend.topic}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
          <div
            className="flex items-center gap-1"
            aria-label={`Relevance ${trend.relevanceScore} of 10`}
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
          {trend.volume !== null ? <span>{trend.volume.toLocaleString()} posts</span> : null}
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
  const { data, isLoading, error } = useTrendRadar();
  const trends: ScoredTrend[] = data?.scored ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trend Radar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Trending topics relevant to your brand, scored against your voice and performance.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <TrendingUp className="h-3 w-3" aria-hidden="true" />
          <span>{trends.length} active</span>
        </Badge>
      </div>

      {isLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">
          Loading trends…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive"
        >
          <p className="text-base font-semibold">Could not load trend radar</p>
          <p className="mt-2 text-sm">
            {error instanceof Error ? error.message : "Please try again."}
          </p>
        </div>
      ) : trends.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No trending topics yet</p>
          <p className="text-sm mt-1">
            OmniPost scans real-time web search, your own analytics, and inbox mentions every day.
            Check back soon, or connect more channels to broaden the signal.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["NOW", "TODAY", "THIS_WEEK"] as const).map((urgency) => {
            const items = trends.filter((t) => t.urgency === urgency);
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
                    {URGENCY_LABEL[urgency]}
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
