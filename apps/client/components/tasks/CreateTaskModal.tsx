/**
 * @file CreateTaskModal.tsx
 * @component CreateTaskModal
 * @description Modal for creating new tasks with title, description, priority, and due date.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { useCreateTask } from "@/hooks/api/useTasks";

interface CreateTaskModalProps {
  accountId: string;
  userId: string;
  open: boolean;
  onClose: () => void;
}

const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export function CreateTaskModal({ accountId, userId, open, onClose }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  const createMutation = useCreateTask();

  const canSubmit = title.trim().length > 0 && !createMutation.isPending;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      await createMutation.mutateAsync({
        accountId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        ...(dueDate ? { dueDate } : {}),
        createdById: userId,
      });

      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setDueDate("");
      onClose();
    },
    [accountId, userId, title, description, priority, dueDate, canSubmit, createMutation, onClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg rounded-lg bg-card border shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-4">New Task</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="task-title">Title *</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              maxLength={200}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details..."
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as (typeof PRIORITY_OPTIONS)[number])}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="task-due-date">Due Date</Label>
              <Input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createMutation.isPending ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
