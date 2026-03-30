/**
 * @file useContentCalendar.ts
 * @description TanStack Query hook for AI content calendar generation.
 * @layer client-hooks
 */

"use client";

import { useMutation } from "@tanstack/react-query";

export interface CalendarItem {
  suggestedDate: string;
  platform: string;
  contentType: "educational" | "promotional" | "engagement" | "behind_scenes";
  ideaTitle: string;
  ideaBrief: string;
  suggestedHashtags: string[];
}

export interface ContentCalendarResult {
  month: string;
  totalPosts: number;
  calendarItems: CalendarItem[];
  summary: string;
}

interface GenerateCalendarInput {
  accountId: string;
  month: string;
  goal: string;
  industry: string;
  platforms: string[];
  postsPerWeek?: number;
  contentMix?: {
    educational: number;
    promotional: number;
    engagement: number;
    behindScenes: number;
  };
}

async function generateCalendar(input: GenerateCalendarInput): Promise<ContentCalendarResult> {
  const res = await fetch("/api/backend/ai/content-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to generate calendar");
  const data = (await res.json()) as { ok: boolean; value?: ContentCalendarResult };
  if (!data.ok || !data.value) throw new Error("Generation failed");
  return data.value;
}

export function useContentCalendar() {
  return useMutation({
    mutationFn: generateCalendar,
  });
}
