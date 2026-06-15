"use client";

/**
 * @file StoriesEditor.tsx
 * @component StoriesEditor
 * @description Orchestrator component for the Instagram Stories editor. Composes
 * sub-components from the stories/ subdirectory: header, timeline, preview,
 * editor controls, and loading overlay. Manages top-level state and delegates
 * presentation to child components.
 * @layer infrastructure
 */

import React, { useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@packages/ui";
import type { VideoSplitOptions } from "@providers/instagram/src/mediaProcessor";
import type { StoriesProject, StoriesEditorProps, StoryContent } from "./stories/types.js";
import { StoriesHeader } from "./stories/StoriesHeader.js";
import { StoriesTimeline } from "./stories/StoriesTimeline.js";
import { StoryPreview } from "./stories/StoryPreview.js";
import { StoryEditorControls } from "./stories/StoryEditorControls.js";
import { LoadingOverlay } from "./stories/LoadingOverlay.js";
import { useFileUpload } from "./stories/hooks/useFileUpload.js";
import { useStoryManagement } from "./stories/hooks/useStoryManagement.js";
import { useKeyboardShortcuts } from "./stories/hooks/useKeyboardShortcuts.js";

export function StoriesEditor({
  projectId: _projectId,
  accountId: _accountId,
  onSave,
  onSchedule,
  onPublish,
  onError,
}: StoriesEditorProps) {
  const t = useTranslations("instagram.components");

  // State management
  const [project, setProject] = useState<StoriesProject>(() => ({
    id: `stories-${Date.now()}`,
    name: t("storiesEditor.defaultProjectName"),
    stories: [],
    status: "draft",
    targetAccounts: [],
  }));

  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [videoSplitOptions, setVideoSplitOptions] = useState<VideoSplitOptions>({
    segmentLength: 15,
    maxSegments: 20,
    aspectRatio: "9:16",
    quality: "high",
    addTransitions: false,
  });

  const selectedStory =
    selectedStoryIndex !== null ? project.stories[selectedStoryIndex] : undefined;

  // Video split confirmation dialog state
  const [splitConfirmOpen, setSplitConfirmOpen] = useState(false);
  const [splitConfirmDuration, setSplitConfirmDuration] = useState<number>(0);
  const splitResolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirmVideoSplit = useCallback((durationSeconds: number): Promise<boolean> => {
    return new Promise((resolve) => {
      splitResolverRef.current = resolve;
      setSplitConfirmDuration(durationSeconds);
      setSplitConfirmOpen(true);
    });
  }, []);

  const resolveSplit = useCallback((decision: boolean) => {
    splitResolverRef.current?.(decision);
    splitResolverRef.current = null;
    setSplitConfirmOpen(false);
  }, []);

  // Story list updater for hooks
  const handleStoriesUpdate = useCallback(
    (updater: (stories: StoryContent[]) => StoryContent[]) => {
      setProject((prev) => ({
        ...prev,
        stories: updater(prev.stories),
      }));
    },
    []
  );

  // File upload hook
  const { isUploading, isProcessing, handleFileUpload } = useFileUpload({
    videoSplitOptions,
    onStoryCreate: useCallback((story: StoryContent) => {
      setProject((prev) => ({
        ...prev,
        stories: [...prev.stories, story],
      }));
    }, []),
    onStoriesCreate: useCallback((stories: StoryContent[]) => {
      setProject((prev) => ({
        ...prev,
        stories: [...prev.stories, ...stories],
      }));
    }, []),
    confirmVideoSplit,
    ...(onError !== undefined && { onError }),
  });

  // Story management hook
  const { addTextStory, updateStory, deleteStory } = useStoryManagement({
    onUpdate: handleStoriesUpdate,
    selectedStoryIndex,
    onSelectStory: setSelectedStoryIndex,
  });

  // Save and schedule handlers
  const handleSave = useCallback(() => {
    if (project.stories.length === 0) {
      onError?.(t("storiesEditor.errorEmptySave"));
      return;
    }

    setProject((prev) => ({ ...prev, status: "ready" }));
    onSave?.(project);
  }, [project, onSave, onError, t]);

  const handleSchedule = useCallback(() => {
    if (project.stories.length === 0) {
      onError?.(t("storiesEditor.errorEmptySchedule"));
      return;
    }

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const updatedProject = {
      ...project,
      scheduledAt,
      status: "scheduled" as const,
    };

    setProject(updatedProject);
    onSchedule?.(updatedProject, scheduledAt);
  }, [project, onSchedule, onError, t]);

  const handlePublish = useCallback(() => {
    if (project.stories.length === 0) {
      onError?.(t("storiesEditor.errorEmptyPublish"));
      return;
    }

    setProject((prev) => ({ ...prev, status: "published" }));
    onPublish?.(project);
  }, [project, onPublish, onError, t]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    selectedStoryIndex,
    totalStories: project.stories.length,
    onSave: handleSave,
    onSelectStory: setSelectedStoryIndex,
  });

  // Project name change handler
  const handleProjectNameChange = useCallback((name: string) => {
    setProject((prev) => ({ ...prev, name }));
  }, []);

  const isDisabled = isUploading || isProcessing;

  return (
    <div className="stories-editor h-screen flex flex-col bg-gray-100">
      <StoriesHeader
        project={project}
        isDisabled={isDisabled}
        onProjectNameChange={handleProjectNameChange}
        onSave={handleSave}
        onSchedule={handleSchedule}
        onPublish={handlePublish}
      />

      <div className="flex-1 flex overflow-hidden">
        <StoriesTimeline
          stories={project.stories}
          selectedStoryIndex={selectedStoryIndex}
          isDisabled={isDisabled}
          onStorySelect={setSelectedStoryIndex}
          onStoryDelete={deleteStory}
          onImageUpload={(files) => handleFileUpload(files, "image")}
          onVideoUpload={(files) => handleFileUpload(files, "video")}
          onAddTextStory={addTextStory}
        />

        <div className="flex-1 flex flex-col bg-gray-50">
          {selectedStory && selectedStoryIndex !== null ? (
            <>
              <StoryPreview
                story={selectedStory}
                storyIndex={selectedStoryIndex}
                totalStories={project.stories.length}
              />

              <StoryEditorControls
                story={selectedStory}
                storyIndex={selectedStoryIndex}
                videoSplitOptions={videoSplitOptions}
                onUpdateStory={updateStory}
                onUpdateVideoSplitOptions={setVideoSplitOptions}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-6xl mb-4">📱</div>
                <div className="text-xl font-medium mb-2">{t("storiesEditor.noStorySelected")}</div>
                <div className="text-sm">{t("storiesEditor.noStorySelectedHint")}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <LoadingOverlay isUploading={isUploading} isProcessing={isProcessing} />

      <ConfirmDialog
        open={splitConfirmOpen}
        onOpenChange={(open) => {
          if (!open) resolveSplit(false);
        }}
        title={t("storiesEditor.splitConfirmTitle")}
        description={t("storiesEditor.splitConfirmDescription", {
          duration: splitConfirmDuration.toFixed(1),
        })}
        confirmLabel={t("storiesEditor.splitConfirmConfirm")}
        cancelLabel={t("storiesEditor.splitConfirmCancel")}
        onConfirm={() => resolveSplit(true)}
      />
    </div>
  );
}
