/**
 * @file page.tsx
 * @description Publishing queue page displaying BullMQ job status with live polling, allowing
 * admin users to monitor, retry, and remove publishing jobs via TanStack Query.
 */
"use client";
import { PublishingQueueManager } from "@/components/queue/PublishingQueueManager";
import { useProject } from "@/providers/ProjectProvider";

export default function QueuePage() {
  const { projectId, accountId } = useProject();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Publishing Queue</h1>
        <p className="text-gray-600">Monitor and manage your content publishing pipeline</p>
      </div>
      <PublishingQueueManager accountId={accountId} projectId={projectId} />
    </div>
  );
}
