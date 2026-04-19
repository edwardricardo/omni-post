/**
 * @file AnnouncementBanner.tsx
 * @description Displays active system announcements as dismissible banners.
 *   Fetches from public endpoint (no auth). Dismissed IDs stored in localStorage.
 * @layer infrastructure
 */
"use client";

import { useState, useEffect } from "react";
import { X, Info, AlertTriangle, Wrench, AlertOctagon } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: "INFO" | "WARNING" | "MAINTENANCE" | "CRITICAL";
}

const TYPE_STYLES: Record<string, { bg: string; border: string; icon: typeof Info }> = {
  INFO: { bg: "bg-blue-950/50", border: "border-blue-700", icon: Info },
  WARNING: { bg: "bg-amber-950/50", border: "border-amber-700", icon: AlertTriangle },
  MAINTENANCE: { bg: "bg-amber-950/50", border: "border-amber-700", icon: Wrench },
  CRITICAL: { bg: "bg-red-950/50", border: "border-red-700", icon: AlertOctagon },
};

const STORAGE_KEY = "dismissed-announcements";

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDismissed(id: string): void {
  const dismissed = getDismissed();
  dismissed.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
}

/**
 * @component AnnouncementBanner
 * @description Renders active system announcements. Dismissible per-announcement via localStorage.
 */
export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(getDismissed());
    fetch("/api/announcements/active")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) setAnnouncements(json.data);
      })
      .catch(() => {});
  }, []);

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((a) => {
        const style = TYPE_STYLES[a.type] ?? TYPE_STYLES["INFO"]!;
        const Icon = style?.icon ?? Info;
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-lg border ${style.border} ${style.bg} px-4 py-3`}
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-current" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.message}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                addDismissed(a.id);
                setDismissed((prev) => new Set([...prev, a.id]));
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
