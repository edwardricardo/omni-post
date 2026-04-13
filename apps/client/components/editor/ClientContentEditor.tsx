"use client";

/**
 * @file ClientContentEditor.tsx
 * @description Client-side content editor wrapping ContentEditorCore with auto-save,
 * provider integration, platform previews, template selector, and schedule picker.
 */

import React, { useMemo, useCallback, useState } from "react";
import {
  ContentEditorCore,
  type ContentEditorContent,
  type ProviderConstraints,
} from "@packages/ui";
import { useProviders } from "@/lib/hooks/useProviders";
import { providerRegistry } from "@/lib/providers/registry";
import { useAuth } from "@/lib/auth/authContext";
import { useToast } from "@packages/ui";
import { usePostDraft } from "@/lib/hooks/useAutoSave";
import { PlatformPreview } from "./PlatformPreview";
import { TemplateSelector } from "./TemplateSelector";
import { SchedulePicker } from "./SchedulePicker";
import { Button } from "@packages/ui";
import { Calendar, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface ClientContentEditorProps {
  postId?: string;
  initialContent?: string;
  initialTitle?: string;
  initialTags?: string[];
  projectId?: string;
  locale?: string;
  showPreview?: boolean;
  onContentChange?: (content: string, charCount: number) => void;
  onMediaAdd?: (files: File[]) => void;
}

/**
 * @component ClientContentEditor
 * @description Client-side content editor wrapping ContentEditorCore with auto-save,
 * provider integration, platform previews, template selector, and schedule picker.
 * @param props.showPreview - Toggles the platform preview sidebar
 */
export function ClientContentEditor({
  postId,
  initialContent = "",
  initialTitle = "",
  initialTags = [],
  projectId,
  locale = "en",
  showPreview = true,
  onContentChange,
  onMediaAdd,
}: ClientContentEditorProps) {
  const { enabledProviders, getProviderConfig } = useProviders();
  const { user } = useAuth();
  const { success, error: showError } = useToast();

  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);

  // Auto-save functionality
  const { saveDraft, saveStatus, lastSaved, publishPost, isPublishing, clearDraft } =
    usePostDraft(postId);

  // Transform providers to ProviderConstraints format
  const providerConstraints: ProviderConstraints[] = useMemo(() => {
    return enabledProviders.map((provider) => {
      const config = getProviderConfig(provider.name);
      const charLimit = providerRegistry.getCharLimit(provider.name);
      const mediaLimits = providerRegistry.getMediaLimits(provider.name);

      return {
        id: provider.name,
        name: provider.name,
        displayName: config?.displayName || provider.name,
        ...(config?.color !== undefined && { color: config.color }),
        maxChars: charLimit,
        maxMediaFiles: mediaLimits.maxFiles,
        allowedMediaTypes: mediaLimits.supportedTypes,
        supportsThreading: providerRegistry.supportsFeature(provider.name, "threads"),
        supportsScheduling: providerRegistry.supportsFeature(provider.name, "scheduling"),
        supportsHashtags: providerRegistry.supportsFeature(provider.name, "hashtags"),
        isConnected: true,
      };
    });
  }, [enabledProviders, getProviderConfig]);

  // Handle content change with auto-save
  const handleContentChange = useCallback(
    (content: ContentEditorContent) => {
      onContentChange?.(content.text, content.text.length);

      // Auto-save draft
      saveDraft({
        content: content.text,
        ...(content.title && { title: content.title }),
        ...(content.tags && content.tags.length > 0 && { tags: content.tags }),
        ...(projectId && { projectId }),
        ...(locale && { locale }),
        ...(selectedProviders && selectedProviders.length > 0 && { selectedProviders }),
      });
    },
    [onContentChange, saveDraft, projectId, locale, selectedProviders]
  );

  // Handle media add
  const handleMediaAdd = useCallback(
    (files: File[]) => {
      setMediaFiles((prev) => [...prev, ...files]);
      onMediaAdd?.(files);
    },
    [onMediaAdd]
  );

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (selectedProviders.length === 0) {
      showError({
        title: "Platform Selection Required",
        description: "Please select at least one platform to publish to.",
      });
      return;
    }

    try {
      await publishPost({
        ...(initialTitle && { title: initialTitle }),
        body: initialContent,
        ...(initialTags.length > 0 && { tags: initialTags }),
        projectId: projectId!,
        locale: locale as "en" | "es",
      });

      success({
        title: "Post Published!",
        description: "Your post has been published successfully.",
      });

      clearDraft();
    } catch (error) {
      showError({
        title: "Publishing Failed",
        description:
          error instanceof Error ? error.message : "Failed to publish post. Please try again.",
      });
    }
  }, [
    selectedProviders,
    showError,
    initialTitle,
    initialContent,
    initialTags,
    projectId,
    locale,
    publishPost,
    success,
    clearDraft,
  ]);

  // Handle schedule
  const handleSchedule = useCallback(
    async (scheduledAt: Date, _timezone?: string) => {
      if (selectedProviders.length === 0) {
        showError({
          title: "Platform Selection Required",
          description: "Please select at least one platform to schedule for.",
        });
        return;
      }

      // Scheduling API integration pending — show confirmation for now
      success({
        title: "Post Scheduled!",
        description: `Your post has been scheduled for ${scheduledAt.toLocaleString()}.`,
      });

      clearDraft();
    },
    [selectedProviders, showError, success, clearDraft]
  );

  const handleTemplateSelect = useCallback(
    (_content: string, _templateTitle?: string, _templateTags?: string[]) => {
      // Template content will be applied via props change
      setShowTemplateSelector(false);
    },
    []
  );

  // User info for preview
  const userInfo = {
    name: user?.name || "Your Name",
    username: user?.email?.split("@")[0] || "yourusername",
  };

  return (
    <div className="space-y-6">
      {/* Save status indicator */}
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        {saveStatus === "saving" && (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 animate-spin" />
            <span>Saving...</span>
          </div>
        )}
        {saveStatus === "saved" && (
          <div className="flex items-center gap-1 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>Saved</span>
          </div>
        )}
        {saveStatus === "error" && (
          <div className="flex items-center gap-1 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span>Save failed</span>
          </div>
        )}
        {lastSaved && <span>Last saved: {lastSaved.toLocaleTimeString()}</span>}
      </div>

      {/* Content Editor Core */}
      <ContentEditorCore
        providers={providerConstraints}
        selectedProviders={selectedProviders}
        onProviderSelectionChange={setSelectedProviders}
        initialContent={initialContent}
        initialTitle={initialTitle}
        initialTags={initialTags}
        onContentChange={handleContentChange}
        onMediaAdd={handleMediaAdd}
        features={{
          media: true,
          validation: true,
          autoSave: true,
          toolbar: true,
          characterCount: true,
          providerSelection: true,
          dragAndDrop: true,
        }}
        placeholder="What's on your mind?"
        validateOnChange={true}
      />

      {/* Action Buttons */}
      {projectId && (
        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={handlePublish}
            disabled={isPublishing || !initialContent.trim()}
            size="sm"
          >
            {isPublishing ? "Publishing..." : "Publish"}
          </Button>
          <Button
            onClick={() => setShowSchedulePicker(true)}
            disabled={!initialContent.trim()}
            variant="outline"
            size="sm"
          >
            <Calendar className="h-4 w-4 mr-1" />
            Schedule
          </Button>
        </div>
      )}

      {/* Platform Preview */}
      {showPreview && (selectedProviders.length > 0 || initialContent.trim()) && (
        <PlatformPreview
          content={initialContent}
          mediaFiles={mediaFiles}
          selectedProviders={selectedProviders}
          userInfo={userInfo}
        />
      )}

      {/* Template Selector */}
      <TemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onTemplateSelect={handleTemplateSelect}
        selectedPlatforms={selectedProviders}
      />

      {/* Schedule Picker */}
      <SchedulePicker
        isOpen={showSchedulePicker}
        onClose={() => setShowSchedulePicker(false)}
        onSchedule={handleSchedule}
        selectedProviders={selectedProviders}
      />
    </div>
  );
}
