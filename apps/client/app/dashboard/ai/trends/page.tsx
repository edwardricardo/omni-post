/**
 * @file page.tsx
 * @description Trend Radar page showing relevant trending topics with post ideas.
 * @layer infrastructure
 */

"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";
import { TrendingUp, Sparkles } from "lucide-react";

interface ScoredTrend {
  topic: string;
  platform: string;
  relevanceScore: number;
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
  volume: number | null;
}

const URGENCY_STYLES = {
  NOW: "bg-red-100 text-red-700",
  TODAY: "bg-yellow-100 text-yellow-700",
  THIS_WEEK: "bg-green-100 text-green-700",
} as const;

/**
 * @component TrendsPage
 * @description Displays a trend radar with relevant trending topics, urgency levels, and AI-generated post ideas.
 */
export default function TrendsPage() {
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const [trends, setTrends] = useState<ScoredTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrends() {
      try {
        const res = await fetch(`/api/backend/trends/radar?accountId=${accountId}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; value?: { scored: ScoredTrend[] } };
          if (data.ok && data.value) setTrends(data.value.scored);
        }
      } finally {
        setLoading(false);
      }
    }
    if (accountId) fetchTrends();
  }, [accountId]);

  const byUrgency = (urgency: string) => trends.filter((t) => t.urgency === urgency);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trend Radar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Trending topics relevant to your brand, right now
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          <TrendingUp className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading trends...</div>
      ) : trends.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No trending topics found</p>
          <p className="text-sm mt-1">
            Connect TikTok to see trending topics relevant to your brand.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["NOW", "TODAY", "THIS_WEEK"] as const).map((urgency) => {
            const items = byUrgency(urgency);
            if (items.length === 0) return null;
            return (
              <div key={urgency}>
                <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_STYLES[urgency]}`}
                  >
                    {urgency === "NOW" ? "Post Now" : urgency === "TODAY" ? "Today" : "This Week"}
                  </span>
                  <span className="text-muted-foreground">({items.length})</span>
                </h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  {items.map((trend) => (
                    <div key={trend.topic} className="rounded-lg border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium">{trend.topic}</h3>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.round(trend.relevanceScore / 2) }).map(
                            (_, i) => (
                              <span key={i} className="text-yellow-500 text-xs">
                                &#9733;
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <span>{trend.platform}</span>
                        {trend.volume && <span>{trend.volume.toLocaleString()} posts</span>}
                      </div>
                      {trend.postIdea && (
                        <div className="mt-2 p-2 rounded bg-muted/50 text-sm">
                          <Sparkles className="h-3 w-3 inline mr-1 text-primary" />
                          {trend.postIdea}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
