"use client";

/**
 * @file ClientContentEditor.tsx
 * @description Client-side content editor wrapping ContentEditorCore with auto-save,
 * provider integration, platform previews, template selector, and schedule picker.
 * @component ClientContentEditor
 * @layer infrastructure
 */

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  ChannelMultiSelect,
  ContentEditorCore,
  computeDefaultChannelSelection,
  type ContentEditorContent,
  type ProviderConstraints,
} from "@packages/ui";
import { useProviders } from "@/lib/hooks/useProviders";
import { providerRegistry } from "@/lib/providers/registry";
import { useAuth } from "@/lib/auth/authContext";
import { useToast } from "@packages/ui";
import { usePostDraft } from "@/lib/hooks/useAutoSave";
import { useProjectChannels } from "@/lib/hooks/useProjectChannels";
import { useSchedulePostViaSaga } from "@/lib/hooks/useSchedulePostViaSaga";
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
  const t = useTranslations("editor");
  const { enabledProviders, getProviderConfig } = useProviders();
  const { user } = useAuth();
  const { success, error: showError } = useToast();

  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [serverPostId, setServerPostId] = useState<string | undefined>(postId);

  // Auto-save functionality
  const { saveDraft, saveNow, saveStatus, lastSaved, publishPost, isPublishing, clearDraft } =
    usePostDraft(postId, setServerPostId);

  const channelsQuery = useProjectChannels(projectId);
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);
  const scheduleMutation = useSchedulePostViaSaga();

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

  // Reconcile the channel selection whenever the user toggles providers on/off
  // or the channel list arrives. New providers get their primary channel
  // pre-selected (smart default); removed providers lose their channels;
  // explicit user overrides on still-active providers are preserved.
  useEffect(() => {
    setSelectedChannelIds((prev) => {
      const prevSet = new Set(prev);
      const next: string[] = [];
      for (const provider of selectedProviders) {
        const groupChannels = channels.filter((c) => c.platform === provider);
        if (groupChannels.length === 0) continue;
        const userKept = groupChannels.filter((c) => prevSet.has(c.id)).map((c) => c.id);
        if (userKept.length > 0) {
          next.push(...userKept);
          continue;
        }
        const defaults = computeDefaultChannelSelection(groupChannels, [provider]);
        next.push(...defaults);
      }
      const sameLength = next.length === prev.length;
      const sameContents = sameLength && next.every((id, i) => id === prev[i]);
      return sameContents ? prev : next;
    });
  }, [selectedProviders, channels]);

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
        title: t("toast.platformRequiredTitle"),
        description: t("toast.platformRequiredPublishDescription"),
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
        title: t("toast.publishedTitle"),
        description: t("toast.publishedDescription"),
      });

      clearDraft();
    } catch (error) {
      showError({
        title: t("toast.publishFailedTitle"),
        description: error instanceof Error ? error.message : t("toast.publishFailedDescription"),
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
    t,
  ]);

  // Handle schedule — canonical state-machine flow: ensure the post exists on
  // the server (autosave is debounced; flush it first), then call the schedule
  // endpoint with the resolved channel ids.
  const handleSchedule = useCallback(
    async (scheduledAt: Date, _timezone?: string) => {
      if (selectedProviders.length === 0) {
        showError({
          title: t("toast.platformRequiredTitle"),
          description: t("toast.platformRequiredScheduleDescription"),
        });
        return;
      }

      if (selectedChannelIds.length === 0) {
        showError({
          title: t("toast.channelRequiredTitle"),
          description: t("toast.channelRequiredDescription"),
        });
        return;
      }

      try {
        await saveNow();
      } catch (err) {
        showError({
          title: t("toast.scheduleFailedTitle"),
          description: err instanceof Error ? err.message : t("toast.saveDraftFailedDescription"),
        });
        return;
      }

      const targetPostId = serverPostId;
      if (!targetPostId) {
        showError({
          title: t("toast.scheduleFailedTitle"),
          description: t("toast.stillSavingDescription"),
        });
        return;
      }

      try {
        await scheduleMutation.mutateAsync({
          postId: targetPostId,
          scheduledFor: scheduledAt.toISOString(),
          channelIds: selectedChannelIds,
        });

        success({
          title: t("toast.scheduledTitle"),
          description: t("toast.scheduledDescription", { date: scheduledAt.toLocaleString() }),
        });
        clearDraft();
      } catch (err) {
        showError({
          title: t("toast.scheduleFailedTitle"),
          description: err instanceof Error ? err.message : t("toast.scheduleFailedDescription"),
        });
      }
    },
    [
      selectedProviders,
      selectedChannelIds,
      saveNow,
      serverPostId,
      scheduleMutation,
      showError,
      success,
      clearDraft,
      t,
    ]
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
    name: user?.name || t("preview.defaultName"),
    username: user?.email?.split("@")[0] || t("preview.defaultUsername"),
  };

  return (
    <div className="space-y-6">
      {/* Save status indicator */}
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        {saveStatus === "saving" && (
          <div className="flex items-center gap-1">
            <Clock aria-hidden="true" className="h-4 w-4 animate-spin" />
            <span>{t("status.saving")}</span>
          </div>
        )}
        {saveStatus === "saved" && (
          <div role="status" className="flex items-center gap-1 text-green-600">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            <span>{t("status.saved")}</span>
          </div>
        )}
        {saveStatus === "error" && (
          <div role="alert" className="flex items-center gap-1 text-red-600">
            <AlertCircle aria-hidden="true" className="h-4 w-4" />
            <span>{t("status.saveFailed")}</span>
          </div>
        )}
        {lastSaved && (
          <span>{t("status.lastSaved", { time: lastSaved.toLocaleTimeString() })}</span>
        )}
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
        placeholder={t("contentPlaceholder")}
        validateOnChange={true}
      />

      {/* Channel selection — smart default with override */}
      {projectId && selectedProviders.length > 0 && (
        <ChannelMultiSelect
          channels={channels}
          selectedProviders={selectedProviders}
          value={selectedChannelIds}
          onChange={setSelectedChannelIds}
        />
      )}

      {/* Action Buttons */}
      {projectId && (
        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={handlePublish}
            disabled={isPublishing || !initialContent.trim()}
            size="sm"
          >
            {isPublishing ? t("actions.publishing") : t("actions.publish")}
          </Button>
          <Button
            onClick={() => setShowSchedulePicker(true)}
            disabled={
              !initialContent.trim() ||
              scheduleMutation.isPending ||
              selectedChannelIds.length === 0
            }
            variant="outline"
            size="sm"
          >
            <Calendar className="h-4 w-4 mr-1" />
            {scheduleMutation.isPending ? t("actions.scheduling") : t("actions.schedule")}
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
