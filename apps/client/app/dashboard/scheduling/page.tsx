/**
 * @file page.tsx
 * @component SchedulingPage
 * @description Scheduling page with tabbed views for calendar, multi-platform, bulk scheduling,
 * optimal times, and rules. Integrates multiple scheduling components driven by the active project.
 * @layer infrastructure
 */
"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { toast, InputDialog } from "@packages/ui";
import { SchedulingDashboard } from "@/components/scheduling";
import { MultiPlatformScheduler } from "@/components/scheduling/MultiPlatformScheduler";
import { BulkScheduleView } from "@/components/scheduling/views/BulkScheduleView";
import { OptimalTimesView } from "@/components/scheduling/views/OptimalTimesView";
import { RulesView } from "@/components/scheduling/views/RulesView";
import { useProject } from "@/providers/ProjectProvider";
import {
  useOptimalTimes,
  useSchedulingRules,
  useBulkCreateSchedules,
  useCreateSchedulingRule,
  useUpdateSchedulingRule,
  useToggleSchedulingRule,
} from "@/hooks/api/useMultiPlatformScheduling";

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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export default function SchedulingPage() {
  const { projectId, accountId } = useProject();
  const [activeTab, setActiveTab] = useState<TabId>("calendar");
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [addRulePlatformsOpen, setAddRulePlatformsOpen] = useState(false);
  const [pendingRuleName, setPendingRuleName] = useState<string | null>(null);
  const [editRuleTarget, setEditRuleTarget] = useState<string | null>(null);

  const { data: optimalTimes = [] } = useOptimalTimes({ projectId });
  const { data: rules = [] } = useSchedulingRules({ projectId });

  const bulkCreateMutation = useBulkCreateSchedules();
  const createRuleMutation = useCreateSchedulingRule();
  const updateRuleMutation = useUpdateSchedulingRule();
  const toggleRuleMutation = useToggleSchedulingRule();

  const handleBulkSchedule = useCallback(
    async (
      contents: string[],
      providers: string[],
      startDate: Date,
      frequency: "daily" | "weekly" | "monthly",
      interval: number
    ) => {
      const slotInputs = contents.map((_, index) => {
        const scheduleDate = new Date(startDate);
        switch (frequency) {
          case "daily":
            scheduleDate.setDate(startDate.getDate() + index * interval);
            break;
          case "weekly":
            scheduleDate.setDate(startDate.getDate() + index * interval * 7);
            break;
          case "monthly":
            scheduleDate.setMonth(startDate.getMonth() + index * interval);
            break;
        }
        return {
          dayOfWeek: scheduleDate.getDay(),
          hour: scheduleDate.getHours(),
          minute: scheduleDate.getMinutes(),
          providers,
        };
      });

      try {
        const created = await bulkCreateMutation.mutateAsync({
          projectId,
          slots: slotInputs,
        });
        toast({
          title: "Bulk schedule created",
          description: `${created.length} slot${created.length === 1 ? "" : "s"} scheduled.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create bulk schedule.";
        toast({ title: "Bulk schedule failed", description: message, variant: "destructive" });
      }
    },
    [bulkCreateMutation, projectId]
  );

  const handleScheduleAtTime = useCallback((dayOfWeek: number, hour: number) => {
    const dayName = DAY_NAMES[dayOfWeek] ?? "Unknown";
    toast({
      title: "Optimal time selected",
      description: `${dayName} at ${hour}:00. Open a post to schedule it at this time.`,
    });
  }, []);

  const handleAddRuleName = useCallback((name: string) => {
    setPendingRuleName(name);
    setAddRuleOpen(false);
    setAddRulePlatformsOpen(true);
  }, []);

  const handleAddRulePlatforms = useCallback(
    async (raw: string) => {
      if (!pendingRuleName) return;
      const providers = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (providers.length === 0) {
        toast({
          title: "Rule not created",
          description: "At least one platform is required.",
          variant: "destructive",
        });
        setAddRulePlatformsOpen(false);
        setPendingRuleName(null);
        return;
      }
      try {
        await createRuleMutation.mutateAsync({
          projectId,
          name: pendingRuleName,
          providers,
          active: true,
        });
        toast({ title: "Rule created", description: pendingRuleName });
        setActiveTab("rules");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add rule.";
        toast({ title: "Rule creation failed", description: message, variant: "destructive" });
      } finally {
        setAddRulePlatformsOpen(false);
        setPendingRuleName(null);
      }
    },
    [createRuleMutation, pendingRuleName, projectId]
  );

  const handleAddRule = useCallback(() => {
    setAddRuleOpen(true);
  }, []);

  const handleEditRuleName = useCallback(
    async (name: string) => {
      if (!editRuleTarget) return;
      try {
        await updateRuleMutation.mutateAsync({ ruleId: editRuleTarget, name });
        toast({ title: "Rule updated", description: name });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to edit rule.";
        toast({ title: "Rule update failed", description: message, variant: "destructive" });
      } finally {
        setEditRuleTarget(null);
      }
    },
    [editRuleTarget, updateRuleMutation]
  );

  const handleEditRule = useCallback((ruleId: string) => {
    setEditRuleTarget(ruleId);
  }, []);

  const handleToggleRule = useCallback(
    async (ruleId: string, active: boolean) => {
      try {
        await toggleRuleMutation.mutateAsync({ ruleId, active });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to toggle rule.";
        toast({ title: "Toggle failed", description: message, variant: "destructive" });
      }
    },
    [toggleRuleMutation]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="-mb-px flex space-x-6" role="tablist" aria-label="Scheduling views">
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
        </div>
      </div>

      {/* Recurring posts shortcut */}
      <div className="border-b border-gray-100 bg-gray-50 px-6 py-2 text-right">
        <Link
          href="/dashboard/scheduling/recurring"
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
              onPostScheduled={(_post) => {}}
              onPostUpdated={(_post) => {}}
              onPostCancelled={(_postId) => {}}
              onError={(_error) => {}}
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
              onScheduleCreated={(_schedule) => {}}
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

      {/* Dialogs */}
      <InputDialog
        open={addRuleOpen}
        onOpenChange={setAddRuleOpen}
        title="New scheduling rule"
        description="Name this rule so you can identify it in the list."
        inputLabel="Rule name"
        inputPlaceholder="e.g. Weekday morning posts"
        confirmLabel="Next"
        onConfirm={handleAddRuleName}
      />
      <InputDialog
        open={addRulePlatformsOpen}
        onOpenChange={(open) => {
          setAddRulePlatformsOpen(open);
          if (!open) setPendingRuleName(null);
        }}
        title="Platforms for this rule"
        description="Comma-separated list of platform identifiers."
        inputLabel="Platforms"
        inputPlaceholder="x,instagram,facebook"
        confirmLabel="Create rule"
        loading={createRuleMutation.isPending}
        onConfirm={handleAddRulePlatforms}
      />
      <InputDialog
        open={editRuleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditRuleTarget(null);
        }}
        title="Rename rule"
        description="Enter a new name for this scheduling rule."
        inputLabel="New rule name"
        inputPlaceholder="Updated rule name"
        confirmLabel="Save"
        loading={updateRuleMutation.isPending}
        onConfirm={handleEditRuleName}
      />
    </div>
  );
}
