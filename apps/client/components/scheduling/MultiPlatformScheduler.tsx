"use client";

/**
 * @file MultiPlatformScheduler.tsx
 * @component MultiPlatformScheduler
 * @description Multi-platform post scheduler component that manages scheduling slots across
 * social media platforms, supporting bulk scheduling, optimal time suggestions, and rules.
 * @layer infrastructure
 */

import React, { useState, useCallback } from "react";
import { toast, InputDialog } from "@packages/ui";
import type {
  CreatedSlot,
  SchedulerView,
  CreateScheduleInput,
  BulkCreateScheduleInput,
} from "../../types/multi-platform-scheduling";
import {
  useScheduleSlots,
  useOptimalTimes,
  useSchedulingRules,
  useCreateSchedule,
  useBulkCreateSchedules,
  useCreateSchedulingRule,
  useUpdateSchedulingRule,
  useToggleSchedulingRule,
} from "../../hooks/api/useMultiPlatformScheduling";
import { CalendarView } from "./views/CalendarView";
import { OptimalTimesView } from "./views/OptimalTimesView";
import { RulesView } from "./views/RulesView";
import { BulkScheduleView } from "./views/BulkScheduleView";

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
  // State
  const [view, setView] = useState<SchedulerView>("calendar");
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [editRuleTarget, setEditRuleTarget] = useState<string | null>(null);

  // API hooks
  const { data: slots = [] } = useScheduleSlots({ projectId });
  const { data: optimalTimes = [] } = useOptimalTimes({ projectId });
  const { data: schedulingRules = [] } = useSchedulingRules({ projectId });
  const createScheduleMutation = useCreateSchedule();
  const bulkCreateMutation = useBulkCreateSchedules();
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

      const input: BulkCreateScheduleInput = {
        projectId,
        slots: slotInputs,
      };

      try {
        const createdSchedules = await bulkCreateMutation.mutateAsync(input);
        createdSchedules.forEach((schedule) => onScheduleCreated?.(schedule));
      } catch {
        // Error surfaced by TanStack Query mutation state
      }
    },
    [bulkCreateMutation, onScheduleCreated, projectId]
  );

  const handleAddRule = useCallback(async () => {
    const name = `Rule ${schedulingRules.length + 1}`;
    try {
      await createRuleMutation.mutateAsync({
        projectId,
        name,
        providers: selectedProviders.length > 0 ? selectedProviders : ["x"],
        frequency: "daily",
        active: true,
      });
      toast({ title: "Rule created", description: name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create rule.";
      toast({ title: "Rule creation failed", description: message, variant: "destructive" });
    }
  }, [createRuleMutation, projectId, schedulingRules.length, selectedProviders]);

  const handleEditRule = useCallback((ruleId: string) => {
    setEditRuleTarget(ruleId);
  }, []);

  const handleEditRuleName = useCallback(
    async (name: string) => {
      if (!editRuleTarget) return;
      try {
        await updateRuleMutation.mutateAsync({ ruleId: editRuleTarget, name });
        toast({ title: "Rule updated", description: name });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update rule.";
        toast({ title: "Rule update failed", description: message, variant: "destructive" });
      } finally {
        setEditRuleTarget(null);
      }
    },
    [editRuleTarget, updateRuleMutation]
  );

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
    <div className="multi-platform-scheduler">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Content Scheduler</h2>
        <div className="flex space-x-2" role="tablist" aria-label="Scheduler views">
          {[
            { id: "calendar" as const, name: "Calendar", icon: "📅" },
            { id: "optimal" as const, name: "Optimal Times", icon: "⏰" },
            { id: "rules" as const, name: "Rules", icon: "⚙️" },
            { id: "bulk" as const, name: "Bulk Schedule", icon: "📊" },
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

        {view === "bulk" && <BulkScheduleView onBulkSchedule={handleBulkSchedule} />}
      </div>

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
