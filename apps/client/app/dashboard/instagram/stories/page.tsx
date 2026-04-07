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
        onSave={() => {
          alert("Coming soon");
        }}
        onSchedule={() => {
          alert("Coming soon");
        }}
        onPublish={() => {
          alert("Coming soon");
        }}
        onError={(_error) => {
          alert("Coming soon");
        }}
      />
    </div>
  );
}
