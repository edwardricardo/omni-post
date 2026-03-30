/**
 * @file ContentCalendarGenerator.tsx
 * @description UI for generating a full month of content ideas via AI.
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { Calendar, Sparkles } from "lucide-react";
import { useContentCalendar } from "@/hooks/api/useContentCalendar";
import type { CalendarItem } from "@/hooks/api/useContentCalendar";

interface ContentCalendarGeneratorProps {
  accountId: string;
}

const TYPE_COLORS: Record<string, string> = {
  educational: "bg-blue-100 text-blue-800 border-blue-200",
  promotional: "bg-green-100 text-green-800 border-green-200",
  engagement: "bg-purple-100 text-purple-800 border-purple-200",
  behind_scenes: "bg-amber-100 text-amber-800 border-amber-200",
};

const PLATFORMS = ["X", "INSTAGRAM", "LINKEDIN", "TIKTOK", "FACEBOOK", "YOUTUBE"] as const;

function getNextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ContentCalendarGenerator({ accountId }: ContentCalendarGeneratorProps) {
  const [month, setMonth] = useState(getNextMonth());
  const [goal, setGoal] = useState("");
  const [industry, setIndustry] = useState("");
  const [postsPerWeek, setPostsPerWeek] = useState(4);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(["X", "INSTAGRAM", "LINKEDIN"])
  );
  const [view, setView] = useState<"list" | "grid">("list");

  const mutation = useContentCalendar();

  const togglePlatform = useCallback((p: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    if (!goal.trim() || !industry.trim() || selectedPlatforms.size === 0) return;
    mutation.mutate({
      accountId,
      month,
      goal: goal.trim(),
      industry: industry.trim(),
      platforms: Array.from(selectedPlatforms),
      postsPerWeek,
    });
  }, [accountId, month, goal, industry, selectedPlatforms, postsPerWeek, mutation]);

  const hasResults = mutation.data && mutation.data.calendarItems.length > 0;

  return (
    <div className="space-y-6">
      {!hasResults && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cal-month">Month</Label>
              <Input
                id="cal-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cal-industry">Industry</Label>
              <Input
                id="cal-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Fashion, SaaS, Food"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="cal-goal">Goal for this month</Label>
            <textarea
              id="cal-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What do you want to achieve? e.g. Drive awareness for spring collection"
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none mt-1"
            />
          </div>

          <div>
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selectedPlatforms.has(p)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="cal-freq">Posts per week per platform: {postsPerWeek}</Label>
            <input
              id="cal-freq"
              type="range"
              min={1}
              max={7}
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={
              !goal.trim() || !industry.trim() || selectedPlatforms.size === 0 || mutation.isPending
            }
          >
            <Calendar className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Generating calendar..." : "Generate Calendar"}
          </Button>
        </>
      )}

      {mutation.isPending && (
        <div className="text-center py-8">
          <Sparkles className="h-8 w-8 text-primary mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">Crafting your content strategy...</p>
        </div>
      )}

      {hasResults && mutation.data && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <h3 className="font-medium mb-1">Strategy Summary</h3>
            <p className="text-sm text-muted-foreground">{mutation.data.summary}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {mutation.data.totalPosts} posts planned for {mutation.data.month}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`px-3 py-1 text-sm rounded ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`px-3 py-1 text-sm rounded ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Grid
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => mutation.reset()}>
              Regenerate
            </Button>
          </div>

          {view === "list" ? (
            <div className="space-y-2">
              {mutation.data.calendarItems.map((item, i) => (
                <CalendarItemCard key={`${item.suggestedDate}-${item.platform}-${i}`} item={item} />
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mutation.data.calendarItems.map((item, i) => (
                <CalendarItemCard key={`${item.suggestedDate}-${item.platform}-${i}`} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarItemCard({ item }: { item: CalendarItem }) {
  const typeColor = TYPE_COLORS[item.contentType] ?? TYPE_COLORS.educational;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColor}`}>
            {item.contentType.replace("_", " ")}
          </span>
          <span className="text-xs text-muted-foreground">{item.platform}</span>
        </div>
        <span className="text-xs text-muted-foreground">{item.suggestedDate}</span>
      </div>
      <h4 className="text-sm font-medium">{item.ideaTitle}</h4>
      {item.ideaBrief && <p className="text-xs text-muted-foreground mt-1">{item.ideaBrief}</p>}
      {item.suggestedHashtags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.suggestedHashtags.map((tag) => (
            <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
