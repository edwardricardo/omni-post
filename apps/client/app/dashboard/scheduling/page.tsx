/**
 * @file page.tsx
 * @component SchedulingPage
 * @description Scheduling page with tabbed views for calendar, multi-platform, bulk scheduling,
 * optimal times, and rules. Integrates multiple scheduling components driven by the active project.
 */
"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { SchedulingDashboard } from "@/components/scheduling";
import { MultiPlatformScheduler } from "@/components/scheduling/MultiPlatformSchedulerRefactored";
import { BulkScheduleView } from "@/components/scheduling/views/BulkScheduleView";
import { OptimalTimesView } from "@/components/scheduling/views/OptimalTimesView";
import { RulesView } from "@/components/scheduling/views/RulesView";
import { useProject } from "@/providers/ProjectProvider";
import type { OptimalTime, SchedulingRule } from "@/types/multi-platform-scheduling";

type TabId = "calendar" | "multi-platform" | "bulk" | "optimal" | "rules";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "calendar", label: "Calendar & Posts" },
  { id: "multi-platform", label: "Multi-Platform" },
  { id: "bulk", label: "Bulk Schedule" },
  { id: "optimal", label: "Optimal Times" },
  { id: "rules", label: "Rules" },
];

export default function SchedulingPage() {
  const { projectId, accountId } = useProject();
  const [activeTab, setActiveTab] = useState<TabId>("calendar");
  const [optimalTimes, setOptimalTimes] = useState<OptimalTime[]>([]);
  const [rules, setRules] = useState<SchedulingRule[]>([]);

  // C7: Fetch optimal times when the tab is active
  useEffect(() => {
    if (activeTab !== "optimal") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/backend/api/analytics/optimal-times", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.data)) {
          setOptimalTimes(data.data);
        }
      } catch {
        // Silently fail — empty state is shown
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // Fetch rules when the rules tab is active
  useEffect(() => {
    if (activeTab !== "rules") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/backend/api/scheduling/slots", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.data)) {
          setRules(data.data);
        }
      } catch {
        // Silently fail — empty state is shown
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // C6: Bulk schedule handler
  const handleBulkSchedule = useCallback(
    async (
      contents: string[],
      providers: string[],
      startDate: Date,
      frequency: "daily" | "weekly" | "monthly",
      interval: number
    ) => {
      try {
        const res = await fetch("/api/backend/api/scheduling/slots/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            contents,
            providers,
            startDate: startDate.toISOString(),
            frequency,
            interval,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: "Request failed" }));
          alert(`Bulk schedule failed: ${errorData.message || res.statusText}`);
          return;
        }

        alert("Bulk schedule created successfully!");
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to create bulk schedule.");
      }
    },
    []
  );

  // C7: Schedule at optimal time handler
  const handleScheduleAtTime = useCallback((dayOfWeek: number, hour: number) => {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = dayNames[dayOfWeek] || "Unknown";
    alert(
      `Selected optimal time: ${dayName} at ${hour}:00.\nNavigate to a post to schedule it at this time.`
    );
  }, []);

  // C8: Add rule handler
  const handleAddRule = useCallback(async () => {
    const name = prompt("Enter rule name:");
    if (!name) return;

    const platforms = prompt("Enter platforms (comma-separated, e.g. x,instagram,facebook):");
    if (!platforms) return;

    try {
      const res = await fetch("/api/backend/api/scheduling/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          platforms: platforms.split(",").map((p) => p.trim()),
          isActive: true,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Request failed" }));
        alert(`Failed to add rule: ${errorData.message || res.statusText}`);
        return;
      }

      alert("Rule created successfully!");
      // Refresh rules
      setActiveTab("rules");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to add rule.");
    }
  }, []);

  // C8: Edit rule handler
  const handleEditRule = useCallback(async (ruleId: string) => {
    const name = prompt("Enter new rule name:");
    if (!name) return;

    try {
      const res = await fetch(`/api/backend/api/scheduling/slots/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Request failed" }));
        alert(`Failed to edit rule: ${errorData.message || res.statusText}`);
        return;
      }

      alert("Rule updated successfully!");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to edit rule.");
    }
  }, []);

  // C8: Toggle rule handler
  const handleToggleRule = useCallback(async (ruleId: string, active: boolean) => {
    try {
      const res = await fetch(`/api/backend/api/scheduling/slots/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: active }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Request failed" }));
        alert(`Failed to toggle rule: ${errorData.message || res.statusText}`);
        return;
      }

      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, isActive: active } : r)));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to toggle rule.");
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-gray-200 bg-white px-6">
        <nav className="-mb-px flex space-x-6" role="tablist" aria-label="Scheduling views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`tab-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Recurring posts shortcut */}
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-2 text-right">
        <Link
          href="/scheduling/recurring"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Publicaciones recurrentes →
        </Link>
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-auto">
        {activeTab === "calendar" && (
          <div role="tabpanel" id="tab-panel-calendar" aria-label="Calendar & Posts">
            <SchedulingDashboard
              projectId={projectId}
              accountId={accountId}
              onPostScheduled={(_post) => {
                // Success toast pending UI notification package
              }}
              onPostUpdated={(_post) => {
                // Success toast pending UI notification package
              }}
              onPostCancelled={(_postId) => {
                // Success toast pending UI notification package
              }}
              onError={(_error) => {
                // Error toast pending UI notification package
              }}
            />
          </div>
        )}

        {activeTab === "multi-platform" && (
          <div
            role="tabpanel"
            id="tab-panel-multi-platform"
            aria-label="Multi-Platform"
            className="p-6"
          >
            <MultiPlatformScheduler
              projectId={projectId}
              accountId={accountId}
              onScheduleCreated={(_schedule) => {
                // Success toast pending UI notification package
              }}
            />
          </div>
        )}

        {activeTab === "bulk" && (
          <div role="tabpanel" id="tab-panel-bulk" aria-label="Bulk Schedule" className="p-6">
            <BulkScheduleView onBulkSchedule={handleBulkSchedule} projectId={projectId} />
          </div>
        )}

        {activeTab === "optimal" && (
          <div role="tabpanel" id="tab-panel-optimal" aria-label="Optimal Times" className="p-6">
            <OptimalTimesView optimalTimes={optimalTimes} onScheduleAtTime={handleScheduleAtTime} />
          </div>
        )}

        {activeTab === "rules" && (
          <div role="tabpanel" id="tab-panel-rules" aria-label="Rules" className="p-6">
            <RulesView
              rules={rules}
              onAddRule={handleAddRule}
              onEditRule={handleEditRule}
              onToggleRule={handleToggleRule}
            />
          </div>
        )}
      </div>
    </div>
  );
}
