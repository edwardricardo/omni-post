/**
 * @file TaskDetailPanel.tsx
 * @component TaskDetailPanel
 * @description Slide-over panel showing full task details with actions.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { X, Check, Ban } from "lucide-react";
import { PriorityBadge, StatusBadge } from "./TaskBadge";
import type { TaskDto } from "@/hooks/api/useTasks";

interface TaskDetailPanelProps {
  task: TaskDto | null;
  onClose: () => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
}

export function TaskDetailPanel({ task, onClose, onComplete, onCancel }: TaskDetailPanelProps) {
  const t = useTranslations("tasks.components");
  const handleComplete = useCallback(() => {
    if (task) onComplete(task.id);
  }, [task, onComplete]);

  const handleCancel = useCallback(() => {
    if (task) onCancel(task.id);
  }, [task, onCancel]);

  if (!task) return null;

  const isFinal = task.status === "COMPLETED" || task.status === "CANCELLED";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("closeDetails")}
        className="fixed inset-0 bg-black/25 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-50 w-full max-w-md bg-card border-l shadow-lg overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("detailsTitle")}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("closeDetails")}>
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-xl font-medium">{task.title}</h3>
            <div className="flex gap-2 mt-2">
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>

          {task.description && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                {t("descriptionLabel")}
              </h4>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            {task.dueDate && (
              <div>
                <span className="text-muted-foreground">{t("dueDateLabel")}</span>
                <p className="font-medium">{new Date(task.dueDate).toLocaleDateString()}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("createdLabel")}</span>
              <p className="font-medium">{new Date(task.createdAt).toLocaleDateString()}</p>
            </div>
            {task.completedAt && (
              <div>
                <span className="text-muted-foreground">{t("completedLabel")}</span>
                <p className="font-medium">{new Date(task.completedAt).toLocaleDateString()}</p>
              </div>
            )}
          </div>

          {!isFinal && (
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleComplete} className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                {t("complete")}
              </Button>
              <Button variant="outline" onClick={handleCancel} className="flex-1">
                <Ban className="h-4 w-4 mr-2" />
                {t("cancel")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
