/**
 * @file page.tsx
 * @component SchedulingPage
 * @description Scheduling page with tabbed views for calendar, multi-platform, bulk scheduling,
 * optimal times, and rules. Integrates multiple scheduling components driven by the active project.
 * @layer infrastructure
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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

const TAB_IDS: TabId[] = ["calendar", "multi-platform", "bulk", "optimal", "rules"];

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export default function SchedulingPage() {
  const t = useTranslations("scheduling");
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
          title: t("bulkScheduleCreatedTitle"),
          description: t("bulkScheduleCreatedDescription", { count: created.length }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("bulkScheduleFailedFallback");
        toast({
          title: t("bulkScheduleFailedTitle"),
          description: message,
          variant: "destructive",
        });
      }
    },
    [bulkCreateMutation, projectId, t]
  );

  const handleScheduleAtTime = useCallback(
    (dayOfWeek: number, hour: number) => {
      const dayKey = DAY_KEYS[dayOfWeek];
      const dayName = dayKey ? t(`days.${dayKey}`) : t("days.unknown");
      toast({
        title: t("optimalTimeSelectedTitle"),
        description: t("optimalTimeSelectedDescription", { day: dayName, hour }),
      });
    },
    [t]
  );

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
          title: t("ruleNotCreatedTitle"),
          description: t("ruleNotCreatedDescription"),
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
        toast({ title: t("ruleCreatedTitle"), description: pendingRuleName });
        setActiveTab("rules");
      } catch (error) {
        const message = error instanceof Error ? error.message : t("ruleCreationFailedFallback");
        toast({
          title: t("ruleCreationFailedTitle"),
          description: message,
          variant: "destructive",
        });
      } finally {
        setAddRulePlatformsOpen(false);
        setPendingRuleName(null);
      }
    },
    [createRuleMutation, pendingRuleName, projectId, t]
  );

  const handleAddRule = useCallback(() => {
    setAddRuleOpen(true);
  }, []);

  const handleEditRuleName = useCallback(
    async (name: string) => {
      if (!editRuleTarget) return;
      try {
        await updateRuleMutation.mutateAsync({ ruleId: editRuleTarget, name });
        toast({ title: t("ruleUpdatedTitle"), description: name });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("ruleUpdateFailedFallback");
        toast({ title: t("ruleUpdateFailedTitle"), description: message, variant: "destructive" });
      } finally {
        setEditRuleTarget(null);
      }
    },
    [editRuleTarget, updateRuleMutation, t]
  );

  const handleEditRule = useCallback((ruleId: string) => {
    setEditRuleTarget(ruleId);
  }, []);

  const handleToggleRule = useCallback(
    async (ruleId: string, active: boolean) => {
      try {
        await toggleRuleMutation.mutateAsync({ ruleId, active });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("ruleToggleFailedFallback");
        toast({ title: t("ruleToggleFailedTitle"), description: message, variant: "destructive" });
      }
    },
    [toggleRuleMutation, t]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="-mb-px flex space-x-6" role="tablist" aria-label={t("tablistLabel")}>
          {TAB_IDS.map((tabId) => (
            <button
              key={tabId}
              role="tab"
              aria-selected={activeTab === tabId}
              aria-controls={`tab-panel-${tabId}`}
              onClick={() => setActiveTab(tabId)}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                activeTab === tabId
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t(`tabs.${tabId}`)}
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
          {t("recurringShortcut")}
        </Link>
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-auto">
        {activeTab === "calendar" && (
          <div role="tabpanel" id="tab-panel-calendar" aria-label={t("tabs.calendar")}>
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
            aria-label={t("tabs.multi-platform")}
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
          <div role="tabpanel" id="tab-panel-bulk" aria-label={t("tabs.bulk")} className="p-6">
            <BulkScheduleView onBulkSchedule={handleBulkSchedule} projectId={projectId} />
          </div>
        )}

        {activeTab === "optimal" && (
          <div
            role="tabpanel"
            id="tab-panel-optimal"
            aria-label={t("tabs.optimal")}
            className="p-6"
          >
            <OptimalTimesView optimalTimes={optimalTimes} onScheduleAtTime={handleScheduleAtTime} />
          </div>
        )}

        {activeTab === "rules" && (
          <div role="tabpanel" id="tab-panel-rules" aria-label={t("tabs.rules")} className="p-6">
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
        title={t("addRuleNameTitle")}
        description={t("addRuleNameDescription")}
        inputLabel={t("addRuleNameLabel")}
        inputPlaceholder={t("addRuleNamePlaceholder")}
        confirmLabel={t("nextButton")}
        onConfirm={handleAddRuleName}
      />
      <InputDialog
        open={addRulePlatformsOpen}
        onOpenChange={(open) => {
          setAddRulePlatformsOpen(open);
          if (!open) setPendingRuleName(null);
        }}
        title={t("addRulePlatformsTitle")}
        description={t("addRulePlatformsDescription")}
        inputLabel={t("addRulePlatformsLabel")}
        inputPlaceholder={t("addRulePlatformsPlaceholder")}
        confirmLabel={t("createRuleButton")}
        loading={createRuleMutation.isPending}
        onConfirm={handleAddRulePlatforms}
      />
      <InputDialog
        open={editRuleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditRuleTarget(null);
        }}
        title={t("renameRuleTitle")}
        description={t("renameRuleDescription")}
        inputLabel={t("renameRuleLabel")}
        inputPlaceholder={t("renameRulePlaceholder")}
        confirmLabel={t("saveButton")}
        loading={updateRuleMutation.isPending}
        onConfirm={handleEditRuleName}
      />
    </div>
  );
}
