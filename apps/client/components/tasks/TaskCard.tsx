/**
 * @file TaskCard.tsx
 * @component TaskCard
 * @description Individual task card with action buttons.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { Check, X, Clock } from "lucide-react";
import { PriorityBadge, StatusBadge } from "./TaskBadge";
import type { TaskDto } from "@/hooks/api/useTasks";

interface TaskCardProps {
  task: TaskDto;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onClick: (task: TaskDto) => void;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function isDueToday(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const today = new Date();
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  );
}

export function TaskCard({ task, onComplete, onCancel, onClick }: TaskCardProps) {
  const t = useTranslations("tasks.components");
  const handleComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onComplete(task.id);
    },
    [task.id, onComplete]
  );

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCancel(task.id);
    },
    [task.id, onCancel]
  );

  const handleClick = useCallback(() => {
    onClick(task);
  }, [task, onClick]);

  const isFinal = task.status === "COMPLETED" || task.status === "CANCELLED";
  const overdue = isOverdue(task.dueDate);
  const dueToday = isDueToday(task.dueDate);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
      className="rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{task.title}</h3>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {task.dueDate && (
            <span
              className={`flex items-center gap-1 ${
                overdue ? "text-red-600 font-medium" : dueToday ? "text-orange-600" : ""
              }`}
            >
              <Clock className="h-3 w-3" />
              {overdue
                ? t("overdue")
                : dueToday
                  ? t("dueToday")
                  : new Date(task.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>

        {!isFinal && (
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleComplete}
              title={t("complete")}
              aria-label={t("completeTask")}
            >
              <Check aria-hidden="true" className="h-4 w-4 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              title={t("cancel")}
              aria-label={t("cancelTask")}
            >
              <X aria-hidden="true" className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
