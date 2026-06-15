"use client";

/**
 * @file MultiPlatformScheduler.tsx
 * @component MultiPlatformScheduler
 * @description Multi-platform post scheduler component that manages scheduling slots across
 * social media platforms, supporting bulk scheduling, optimal time suggestions, and rules.
 * @layer infrastructure
 */

import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast, InputDialog } from "@packages/ui";
import type {
  CreatedSlot,
  SchedulerView,
  CreateScheduleInput,
} from "../../types/multi-platform-scheduling.js";
import {
  useScheduleSlots,
  useOptimalTimes,
  useSchedulingRules,
  useCreateSchedule,
  useCreateSchedulingRule,
  useUpdateSchedulingRule,
  useToggleSchedulingRule,
} from "../../hooks/api/useMultiPlatformScheduling.js";
import { CalendarView } from "./views/CalendarView.js";
import { OptimalTimesView } from "./views/OptimalTimesView.js";
import { RulesView } from "./views/RulesView.js";
import { BulkScheduleView } from "./views/BulkScheduleView.js";

interface MultiPlatformSchedulerProps {
  accountId: string;
  projectId: string;
  selectedContent?: string;
  selectedProviders?: string[];
  onScheduleCreated?: (schedule: CreatedSlot) => void;
  onScheduleUpdated?: (schedule: CreatedSlot) => void;
  onScheduleDeleted?: (scheduleId: string) => void;
}

export function MultiPlatformScheduler({
  accountId: _accountId,
  projectId,
  selectedContent,
  selectedProviders = [],
  onScheduleCreated,
  onScheduleUpdated: _onScheduleUpdated,
  onScheduleDeleted: _onScheduleDeleted,
}: MultiPlatformSchedulerProps) {
  const t = useTranslations("scheduling.components");
  // State
  const [view, setView] = useState<SchedulerView>("calendar");
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [editRuleTarget, setEditRuleTarget] = useState<string | null>(null);

  // API hooks
  const { data: slots = [] } = useScheduleSlots({ projectId });
  const { data: optimalTimes = [] } = useOptimalTimes({ projectId });
  const { data: schedulingRules = [] } = useSchedulingRules({ projectId });
  const createScheduleMutation = useCreateSchedule();
  const createRuleMutation = useCreateSchedulingRule();
  const updateRuleMutation = useUpdateSchedulingRule();
  const toggleRuleMutation = useToggleSchedulingRule();

  // Handlers
  const handleWeekChange = useCallback((direction: "prev" | "next") => {
    setCurrentWeek((prev) => {
      const newWeek = new Date(prev);
      newWeek.setDate(prev.getDate() + (direction === "next" ? 7 : -7));
      return newWeek;
    });
  }, []);

  const handleCreateSchedule = useCallback(
    async (scheduleData: CreateScheduleInput) => {
      try {
        const schedule = await createScheduleMutation.mutateAsync(scheduleData);
        onScheduleCreated?.(schedule);
      } catch {
        // Error surfaced by TanStack Query mutation state
      }
    },
    [createScheduleMutation, onScheduleCreated]
  );

  const handleSmartSchedule = useCallback(
    async (providers: string[], numberOfPosts: number) => {
      const now = new Date();

      // Get optimal times sorted by engagement
      const relevantOptimalTimes = optimalTimes
        .slice()
        .sort((a, b) => b.avgEngagement - a.avgEngagement)
        .slice(0, numberOfPosts);

      const schedulePromises = relevantOptimalTimes.map(async (optimalTime) => {
        // Find next occurrence of this day/hour
        const daysUntilTarget = (optimalTime.dayOfWeek + 7 - now.getDay()) % 7;
        const daysToAdd =
          daysUntilTarget === 0 && now.getHours() >= optimalTime.hour ? 7 : daysUntilTarget;

        return handleCreateSchedule({
          projectId,
          dayOfWeek: optimalTime.dayOfWeek,
          hour: optimalTime.hour,
          minute: 0,
          providers,
          ...(daysToAdd > 0 && {}), // dayOfWeek already encodes the target day
        });
      });

      await Promise.all(schedulePromises);
    },
    [optimalTimes, handleCreateSchedule, projectId]
  );

  const handleScheduleAtTime = useCallback(
    (dayOfWeek: number, hour: number) => {
      handleCreateSchedule({
        projectId,
        dayOfWeek,
        hour,
        minute: 0,
        providers: selectedProviders,
      });
    },
    [handleCreateSchedule, projectId, selectedProviders]
  );

  const handleAddRule = useCallback(async () => {
    const name = t("ruleDefaultName", { number: schedulingRules.length + 1 });
    try {
      await createRuleMutation.mutateAsync({
        projectId,
        name,
        providers: selectedProviders.length > 0 ? selectedProviders : ["x"],
        frequency: "daily",
        active: true,
      });
      toast({ title: t("ruleCreatedToast"), description: name });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("ruleCreateFailedFallback");
      toast({ title: t("ruleCreateFailedToast"), description: message, variant: "destructive" });
    }
  }, [createRuleMutation, projectId, schedulingRules.length, selectedProviders, t]);

  const handleEditRule = useCallback((ruleId: string) => {
    setEditRuleTarget(ruleId);
  }, []);

  const handleEditRuleName = useCallback(
    async (name: string) => {
      if (!editRuleTarget) return;
      try {
        await updateRuleMutation.mutateAsync({ ruleId: editRuleTarget, name });
        toast({ title: t("ruleUpdatedToast"), description: name });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("ruleUpdateFailedFallback");
        toast({ title: t("ruleUpdateFailedToast"), description: message, variant: "destructive" });
      } finally {
        setEditRuleTarget(null);
      }
    },
    [editRuleTarget, updateRuleMutation, t]
  );

  const handleToggleRule = useCallback(
    async (ruleId: string, active: boolean) => {
      try {
        await toggleRuleMutation.mutateAsync({ ruleId, active });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("ruleToggleFailedFallback");
        toast({ title: t("ruleToggleFailedToast"), description: message, variant: "destructive" });
      }
    },
    [toggleRuleMutation, t]
  );

  return (
    <div className="multi-platform-scheduler">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t("schedulerTitle")}</h2>
        <div className="flex space-x-2" role="tablist" aria-label={t("schedulerViewsAria")}>
          {[
            { id: "calendar" as const, name: t("viewCalendar"), icon: "📅" },
            { id: "optimal" as const, name: t("viewOptimal"), icon: "⏰" },
            { id: "rules" as const, name: t("viewRules"), icon: "⚙️" },
            { id: "bulk" as const, name: t("viewBulk"), icon: "📊" },
          ].map((viewOption) => (
            <button
              key={viewOption.id}
              onClick={() => setView(viewOption.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:ring-2 focus:ring-blue-500 ${
                view === viewOption.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              role="tab"
              aria-selected={view === viewOption.id}
              aria-controls={`${viewOption.id}-panel`}
            >
              <span aria-hidden="true">{viewOption.icon}</span> {viewOption.name}
            </button>
          ))}
        </div>
      </div>

      {/* View content */}
      <div role="tabpanel" id={`${view}-panel`}>
        {view === "calendar" && (
          <CalendarView
            currentWeek={currentWeek}
            slots={slots}
            optimalTimes={optimalTimes}
            selectedProviders={selectedProviders}
            selectedContent={selectedContent}
            onWeekChange={handleWeekChange}
            onCreateSchedule={handleCreateSchedule}
            onSmartSchedule={handleSmartSchedule}
          />
        )}

        {view === "optimal" && (
          <OptimalTimesView optimalTimes={optimalTimes} onScheduleAtTime={handleScheduleAtTime} />
        )}

        {view === "rules" && (
          <RulesView
            rules={schedulingRules}
            onAddRule={handleAddRule}
            onEditRule={handleEditRule}
            onToggleRule={handleToggleRule}
          />
        )}

        {view === "bulk" && <BulkScheduleView projectId={projectId} />}
      </div>

      <InputDialog
        open={editRuleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditRuleTarget(null);
        }}
        title={t("renameRuleTitle")}
        description={t("renameRuleDescription")}
        inputLabel={t("renameRuleInputLabel")}
        inputPlaceholder={t("renameRuleInputPlaceholder")}
        confirmLabel={t("save")}
        loading={updateRuleMutation.isPending}
        onConfirm={handleEditRuleName}
      />
    </div>
  );
}
