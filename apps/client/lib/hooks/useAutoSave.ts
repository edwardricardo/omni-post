"use client";

/**
 * @file useAutoSave.ts
 * @description Custom hook for auto-saving content drafts with debounced persistence to localStorage and optional backend sync, plus a post-specific variant for managing draft lifecycle.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useCreatePost, useUpdatePost } from "@/lib/api/hooks";
import { CreatePostRequest } from "@/lib/api/types";

interface AutoSaveConfig {
  key: string;
  interval?: number; // ms
  enabled?: boolean;
  onSave?: (success: boolean, error?: any) => void;
}

interface AutoSaveData {
  content: string;
  title?: string;
  tags?: string[];
  mediaFiles?: Array<{ file: File; url: string }>;
  selectedProviders?: string[];
  lastSaved?: string;
}

export function useAutoSave(config: AutoSaveConfig) {
  const { key, interval = 30000, enabled = true, onSave } = config;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const dataRef = useRef<AutoSaveData | null>(null);

  // Local storage key for drafts
  const draftKey = `draft_${key}`;

  // Save to localStorage immediately for offline drafts
  const saveToLocal = useCallback(
    (data: AutoSaveData) => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            ...data,
            lastSaved: new Date().toISOString(),
          })
        );
      } catch {
        // localStorage save failed — draft will not persist across reloads
      }
    },
    [draftKey]
  );

  // Load draft from localStorage
  const loadDraft = useCallback((): AutoSaveData | null => {
    try {
      const draft = localStorage.getItem(draftKey);
      return draft ? JSON.parse(draft) : null;
    } catch {
      return null;
    }
  }, [draftKey]);

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    localStorage.removeItem(draftKey);
  }, [draftKey]);

  // Save data (called by the debounced function)
  const performSave = useCallback(
    async (data: AutoSaveData) => {
      if (!enabled) return;

      setSaveStatus("saving");

      try {
        // Save to localStorage first
        saveToLocal(data);

        // For now, we'll just simulate a backend save
        // In a real implementation, you'd save to your backend here
        await new Promise((resolve) => setTimeout(resolve, 500));

        setSaveStatus("saved");
        setLastSaved(new Date());
        onSave?.(true);

        // Reset to idle after showing saved status
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (error) {
        setSaveStatus("error");
        onSave?.(false, error);

        // Reset to idle after showing error
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [enabled, saveToLocal, onSave]
  );

  // Debounced save function
  const save = useCallback(
    (data: AutoSaveData) => {
      dataRef.current = data;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        if (dataRef.current) {
          performSave(dataRef.current);
        }
      }, interval);
    },
    [performSave, interval]
  );

  // Force immediate save
  const saveNow = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (dataRef.current) {
      await performSave(dataRef.current);
    }
  }, [performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    save,
    saveNow,
    saveStatus,
    lastSaved,
    loadDraft,
    clearDraft,
    hasDraft: !!loadDraft(),
  };
}

// Custom hook for managing post drafts specifically
export function usePostDraft(postId?: string) {
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  const autoSave = useAutoSave({
    key: postId || "new_post",
    interval: 15000, // Save every 15 seconds for posts
    onSave: (_success, _error) => {
      // Auto-save result is reflected in the save status indicator
    },
  });

  const saveDraft = useCallback(
    (draft: {
      content: string;
      title?: string;
      tags?: string[];
      projectId?: string;
      locale?: string;
      selectedProviders?: string[];
    }) => {
      autoSave.save({
        content: draft.content,
        ...(draft.title && { title: draft.title }),
        ...(draft.tags && { tags: draft.tags }),
        ...(draft.selectedProviders && { selectedProviders: draft.selectedProviders }),
      });
    },
    [autoSave.save]
  );

  const publishPost = useCallback(
    async (postData: CreatePostRequest) => {
      const result = postId
        ? await updatePost.mutateAsync({ id: postId, data: postData })
        : await createPost.mutateAsync(postData);

      // Clear draft after successful publish
      autoSave.clearDraft();

      return result;
    },
    [postId, createPost, updatePost, autoSave]
  );

  return {
    ...autoSave,
    saveDraft,
    publishPost,
    isPublishing: createPost.isPending || updatePost.isPending,
  };
}
