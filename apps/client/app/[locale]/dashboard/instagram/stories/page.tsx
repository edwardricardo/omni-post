/**
 * @file page.tsx
 * @description Instagram Stories editor page that renders the StoriesEditor component for
 * creating, scheduling, and publishing Instagram Stories for the active project.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";
import { StoriesEditor } from "@/components/instagram";
import { useProject } from "@/providers/ProjectProvider";

/**
 * @component InstagramStoriesPage
 * @description Provides an Instagram Stories editor for creating, scheduling, and publishing stories.
 */
export default function InstagramStoriesPage() {
  const t = useTranslations("instagram");
  const { projectId, accountId } = useProject();

  const showComingSoon = (feature: string) => {
    toast({
      title: t("comingSoonTitle"),
      description: t("comingSoonDescription", { feature }),
    });
  };

  return (
    <div className="h-screen">
      <StoriesEditor
        projectId={projectId}
        accountId={accountId}
        onSave={() => showComingSoon(t("featureSave"))}
        onSchedule={() => showComingSoon(t("featureSchedule"))}
        onPublish={() => showComingSoon(t("featurePublish"))}
        onError={(error: string) =>
          toast({
            title: t("storiesEditorError"),
            description: error,
            variant: "destructive",
          })
        }
      />
    </div>
  );
}
