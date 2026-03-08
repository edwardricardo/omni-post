/**
 * @file page.tsx
 * @description New post creation page that renders the UnifiedPublishingDashboard component
 * for composing and publishing content to multiple social media platforms simultaneously.
 */
"use client";

import { UnifiedPublishingDashboard } from "@/components/publishing/UnifiedPublishingDashboard";
import { useProject } from "@/providers/ProjectProvider";

export default function NewPostPage() {
  const { projectId, accountId } = useProject();

  return (
    <UnifiedPublishingDashboard
      accountId={accountId}
      projectId={projectId}
      onPublishSuccess={(_queueItem) => {
        // Success toast and redirect pending UI notification package
      }}
      onPublishError={(_error) => {
        // Error toast pending UI notification package
      }}
    />
  );
}
