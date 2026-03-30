/**
 * @file page.tsx
 * @description Task management page with list, creation modal, and detail panel.
 * @layer client-pages
 */

"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";
import { Plus } from "lucide-react";
import { TaskList } from "@/components/tasks/TaskList";
import { CreateTaskModal } from "@/components/tasks/CreateTaskModal";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { useCompleteTask, useCancelTask } from "@/hooks/api/useTasks";
import type { TaskDto } from "@/hooks/api/useTasks";

export default function TasksPage() {
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskDto | null>(null);

  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const userId = user?.id ?? "";

  const completeMutation = useCompleteTask();
  const cancelMutation = useCancelTask();

  const handleComplete = useCallback(
    (taskId: string) => {
      completeMutation.mutate({ taskId, accountId, completedById: userId });
      setSelectedTask(null);
    },
    [accountId, userId, completeMutation]
  );

  const handleCancel = useCallback(
    (taskId: string) => {
      cancelMutation.mutate({ taskId, accountId, cancelledById: userId });
      setSelectedTask(null);
    },
    [accountId, userId, cancelMutation]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage and track your team&apos;s work
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      <TaskList accountId={accountId} userId={userId} onTaskClick={setSelectedTask} />

      <CreateTaskModal
        accountId={accountId}
        userId={userId}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <TaskDetailPanel
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  );
}
