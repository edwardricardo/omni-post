/**
 * @file page.tsx
 * @description Instagram Stories editor page that renders the StoriesEditor component for
 * creating, scheduling, and publishing Instagram Stories for the active project.
 * @layer infrastructure
 */
"use client";

import { toast } from "@packages/ui";
import { StoriesEditor } from "@/components/instagram";
import { useProject } from "@/providers/ProjectProvider";

function showComingSoon(feature: string) {
  toast({
    title: "Coming soon",
    description: `${feature} is not available yet.`,
  });
}

/**
 * @component InstagramStoriesPage
 * @description Provides an Instagram Stories editor for creating, scheduling, and publishing stories.
 */
export default function InstagramStoriesPage() {
  const { projectId, accountId } = useProject();

  return (
    <div className="h-screen">
      <StoriesEditor
        projectId={projectId}
        accountId={accountId}
        onSave={() => showComingSoon("Save")}
        onSchedule={() => showComingSoon("Schedule")}
        onPublish={() => showComingSoon("Publish")}
        onError={(error: string) =>
          toast({
            title: "Stories editor error",
            description: error,
            variant: "destructive",
          })
        }
      />
    </div>
  );
}
