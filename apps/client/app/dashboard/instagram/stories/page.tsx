/**
 * @file page.tsx
 * @description Instagram Stories editor page that renders the StoriesEditor component for
 * creating, scheduling, and publishing Instagram Stories for the active project.
 */
"use client";

import { StoriesEditor } from "@/components/instagram";
import { useProject } from "@/providers/ProjectProvider";

export default function InstagramStoriesPage() {
  const { projectId, accountId } = useProject();

  return (
    <div className="h-screen">
      <StoriesEditor
        projectId={projectId}
        accountId={accountId}
        onSave={(_project) => {
          // Save via API not yet integrated
        }}
        onSchedule={(_project, _scheduledAt) => {
          // Schedule via API not yet integrated
        }}
        onPublish={(_project) => {
          // Publish via API not yet integrated
        }}
        onError={(_error) => {
          // Error toast notification pending UI notification package
        }}
      />
    </div>
  );
}
