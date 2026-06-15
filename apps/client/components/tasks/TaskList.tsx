/**
 * @file TaskList.tsx
 * @component TaskList
 * @description Filterable task list with status tabs and priority filter.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTasks, useCompleteTask, useCancelTask } from "@/hooks/api/useTasks";
import type { TaskDto } from "@/hooks/api/useTasks";
import { TaskCard } from "./TaskCard.js";

interface TaskListProps {
  accountId: string;
  userId: string;
  onTaskClick: (task: TaskDto) => void;
}

const STATUS_TABS = [
  { labelKey: "tabs.all", value: undefined },
  { labelKey: "tabs.open", value: "OPEN" },
  { labelKey: "tabs.inProgress", value: "IN_PROGRESS" },
  { labelKey: "tabs.completed", value: "COMPLETED" },
] as const;

const PRIORITY_OPTIONS = [
  { labelKey: "priorityFilter.all", value: undefined },
  { labelKey: "priorityFilter.urgent", value: "URGENT" },
  { labelKey: "priorityFilter.high", value: "HIGH" },
  { labelKey: "priorityFilter.medium", value: "MEDIUM" },
  { labelKey: "priorityFilter.low", value: "LOW" },
] as const;

export function TaskList({ accountId, userId, onTaskClick }: TaskListProps) {
  const t = useTranslations("tasks.components");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [priorityFilter, setPriorityFilter] = useState<string | undefined>(undefined);

  const taskParams = useMemo(
    () => ({
      accountId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(priorityFilter ? { priority: priorityFilter } : {}),
    }),
    [accountId, statusFilter, priorityFilter]
  );

  const { data: tasks = [], isLoading } = useTasks(taskParams);

  const completeMutation = useCompleteTask();
  const cancelMutation = useCancelTask();

  const handleComplete = useCallback(
    (taskId: string) => {
      completeMutation.mutate({ taskId, accountId, completedById: userId });
    },
    [accountId, userId, completeMutation]
  );

  const handleCancel = useCallback(
    (taskId: string) => {
      cancelMutation.mutate({ taskId, accountId, cancelledById: userId });
    },
    [accountId, userId, cancelMutation]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-lg border overflow-hidden">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.labelKey}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <select
          value={priorityFilter ?? ""}
          onChange={(e) => setPriorityFilter(e.target.value || undefined)}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.labelKey} value={opt.value ?? ""}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">{t("loading")}</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">{t("emptyTitle")}</p>
          <p className="text-sm mt-1">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={handleComplete}
              onCancel={handleCancel}
              onClick={onTaskClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
