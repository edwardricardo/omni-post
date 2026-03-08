/**
 * @file page.tsx
 * @description Scheduling page with tabbed views for calendar, multi-platform, bulk scheduling,
 * optimal times, and rules. Integrates multiple scheduling components driven by the active project.
 */
"use client";

import { useState } from "react";
import { SchedulingDashboard } from "@/components/scheduling";
import { MultiPlatformScheduler } from "@/components/scheduling/MultiPlatformSchedulerRefactored";
import { BulkScheduleView } from "@/components/scheduling/views/BulkScheduleView";
import { OptimalTimesView } from "@/components/scheduling/views/OptimalTimesView";
import { RulesView } from "@/components/scheduling/views/RulesView";
import { useProject } from "@/providers/ProjectProvider";

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
            <BulkScheduleView
              onBulkSchedule={(_contents, _providers, _startDate, _frequency, _interval) => {
                // Bulk schedule via API not yet integrated
              }}
            />
          </div>
        )}

        {activeTab === "optimal" && (
          <div role="tabpanel" id="tab-panel-optimal" aria-label="Optimal Times" className="p-6">
            <OptimalTimesView
              optimalTimes={[]}
              onScheduleAtTime={(_dayOfWeek, _hour) => {
                // Schedule-at-time via API not yet integrated
              }}
            />
          </div>
        )}

        {activeTab === "rules" && (
          <div role="tabpanel" id="tab-panel-rules" aria-label="Rules" className="p-6">
            <RulesView
              rules={[]}
              onAddRule={() => {
                // Add rule via API not yet integrated
              }}
              onEditRule={(_ruleId) => {
                // Edit rule modal not yet implemented
              }}
              onToggleRule={(_ruleId, _active) => {
                // Toggle rule via API not yet integrated
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
