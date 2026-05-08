"use client";

/**
 * @file useAutoSave.ts
 * @description Debounced autosave with localStorage offline cache and an optional
 *              server-persistence callback. The post-specific variant
 *              (`usePostDraft`) wires the callback to the real backend mutations:
 *              first save that observes non-empty body issues a `POST /posts`
 *              (single-flight), and every subsequent save patches the returned
 *              id (Pattern Lazy — Notion / Linear). localStorage continues to
 *              run on every keystroke so the draft survives refreshes and offline.
 * @layer infrastructure
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useCreatePost, useUpdatePost } from "@/lib/api/hooks";

/**
 * Public lifecycle callback invoked after each save attempt completes.
 * Receives `ok: true` when both the localStorage write and the optional
 * server persistence succeeded; `ok: false` carries the error.
 */
export interface AutoSaveResult {
  ok: boolean;
  error?: unknown;
}

/**
 * Configuration for the generic autosave hook.
 */
export interface AutoSaveConfig {
  /** Stable identifier used as the localStorage key suffix. */
  key: string;
  /** Debounce window in milliseconds. */
  interval?: number;
  /** When false, neither localStorage nor server persistence runs. */
  enabled?: boolean;
  /**
   * Optional server-persistence callback. Called after the localStorage write
   * with the latest data. The hook exposes the resolved/rejected result via
   * `saveStatus`. When omitted, only localStorage runs and `saveStatus` reports
   * the localStorage outcome.
   */
  onPersist?: (data: AutoSaveData) => Promise<void>;
  /** Notification callback fired after every save attempt completes. */
  onSaveResult?: (result: AutoSaveResult) => void;
}

/**
 * Shape persisted to localStorage and forwarded to `onPersist`. Specific
 * domains may extend it (see `PostDraftData` below).
 */
export interface AutoSaveData {
  body: string;
  title?: string;
  tags?: string[];
  projectId?: string;
  locale?: "es" | "en";
  selectedProviders?: string[];
  mediaFiles?: Array<{ file: File; url: string }>;
  lastSaved?: string;
}

/**
 * @hook useAutoSave
 * @description Debounce-driven autosave that writes to localStorage on every
 *   tick and optionally invokes a server-persistence callback. Tracks save
 *   status (idle / saving / saved / error) and the last successful save time.
 * @param config - Stable key + debounce interval + optional persistence callback.
 * @returns `{ save, saveNow, saveStatus, lastSaved, loadDraft, clearDraft, hasDraft }`.
 */
export function useAutoSave(config: AutoSaveConfig) {
  const { key, interval = 30000, enabled = true, onPersist, onSaveResult } = config;

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const dataRef = useRef<AutoSaveData | null>(null);
  // Track the latest invocation so a long-running persist call cannot leave
  // a stale "saving" status when newer data has already started saving.
  const pendingTokenRef = useRef(0);

  const draftKey = `draft_${key}`;

  const isBrowser = () => typeof window !== "undefined";

  const saveToLocal = useCallback(
    (data: AutoSaveData) => {
      if (!isBrowser()) return;
      try {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({ ...data, lastSaved: new Date().toISOString() })
        );
      } catch {
        // Quota exceeded or storage disabled — silent fall-through. The user's
        // typing is still in component state; this only affects offline recovery.
      }
    },
    [draftKey]
  );

  const loadDraft = useCallback((): AutoSaveData | null => {
    if (!isBrowser()) return null;
    try {
      const raw = window.localStorage.getItem(draftKey);
      return raw ? (JSON.parse(raw) as AutoSaveData) : null;
    } catch {
      return null;
    }
  }, [draftKey]);

  const clearDraft = useCallback(() => {
    if (!isBrowser()) return;
    window.localStorage.removeItem(draftKey);
  }, [draftKey]);

  const performSave = useCallback(
    async (data: AutoSaveData) => {
      if (!enabled) return;

      const token = ++pendingTokenRef.current;
      setSaveStatus("saving");

      try {
        saveToLocal(data);

        if (onPersist) {
          await onPersist(data);
        }

        // A newer save started while we were awaiting `onPersist` — let that
        // newer cycle own the status state.
        if (token !== pendingTokenRef.current) return;

        setSaveStatus("saved");
        setLastSaved(new Date());
        onSaveResult?.({ ok: true });
      } catch (error) {
        if (token !== pendingTokenRef.current) return;
        setSaveStatus("error");
        onSaveResult?.({ ok: false, error });
      }
    },
    [enabled, saveToLocal, onPersist, onSaveResult]
  );

  // Decay "saved" / "error" indicators back to idle so the UI does not stick
  // on a transient state if no further saves occur.
  useEffect(() => {
    if (saveStatus !== "saved" && saveStatus !== "error") return;
    const ttl = saveStatus === "saved" ? 2000 : 3000;
    const handle = setTimeout(() => setSaveStatus("idle"), ttl);
    return () => clearTimeout(handle);
  }, [saveStatus]);

  const save = useCallback(
    (data: AutoSaveData) => {
      dataRef.current = data;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (dataRef.current) void performSave(dataRef.current);
      }, interval);
    },
    [performSave, interval]
  );

  const saveNow = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (dataRef.current) await performSave(dataRef.current);
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
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

// ---------------------------------------------------------------------------
// usePostDraft — wires useAutoSave to the real post mutations (Pattern Lazy)
// ---------------------------------------------------------------------------

/**
 * @hook usePostDraft
 * @description Post-specific autosave wrapper. Combines `useAutoSave` with the
 *   real `useCreatePost` / `useUpdatePost` mutations. Pattern Lazy semantics:
 *   - localStorage write happens on every debounce tick (offline resilience).
 *   - Server save is skipped when the body is empty (the backend rejects empty bodies).
 *   - First server save with non-empty body issues `POST /posts`; subsequent
 *     saves PATCH the returned id. Single-flight on the create so concurrent
 *     ticks during the first round-trip do not produce duplicate posts.
 *
 *   Caller passes the current post id (or undefined for new drafts) plus an
 *   optional `onPostCreated` callback that fires once when a new post is
 *   persisted, so the parent can update its state with the server-issued id.
 *
 * @param postId - Current post id, or undefined for a fresh draft.
 * @param onPostCreated - Optional callback invoked once with the id of a
 *   newly-created post (used by the editor to transition from new-draft mode
 *   to existing-post mode).
 * @returns The same surface as `useAutoSave` plus `saveDraft`, `publishPost`,
 *   and `isPublishing` for the publish flow.
 */
export function usePostDraft(postId?: string, onPostCreated?: (id: string) => void) {
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  // Synced via effect so callbacks always read the latest server-issued id
  // without taking a stale closure on the prop.
  const persistedPostIdRef = useRef<string | undefined>(postId);
  useEffect(() => {
    persistedPostIdRef.current = postId;
  }, [postId]);

  // Single-flight guard: while a create is in flight, additional ticks are
  // queued (next debounce will land as PATCH once the id arrives) instead of
  // issuing a duplicate POST.
  const createInFlightRef = useRef(false);

  const onPersist = useCallback(
    async (data: AutoSaveData): Promise<void> => {
      const body = data.body?.trim();
      if (!body) return; // Pattern Lazy: do not hit the server with empty body.

      const currentId = persistedPostIdRef.current;

      if (currentId) {
        await updatePost.mutateAsync({
          id: currentId,
          data: {
            body,
            ...(data.title !== undefined && { title: data.title }),
            ...(data.tags !== undefined && { tags: data.tags }),
            ...(data.locale !== undefined && { locale: data.locale }),
          },
        });
        return;
      }

      if (createInFlightRef.current) return;
      if (!data.projectId) return; // Cannot create without a project context.

      createInFlightRef.current = true;
      try {
        const response = await createPost.mutateAsync({
          projectId: data.projectId,
          locale: data.locale ?? "en",
          body,
          ...(data.title !== undefined && { title: data.title }),
          ...(data.tags !== undefined && { tags: data.tags }),
        });

        const created = (response as { ok?: boolean; data?: { id?: string } }).data;
        if (created?.id) {
          persistedPostIdRef.current = created.id;
          onPostCreated?.(created.id);
        }
      } finally {
        createInFlightRef.current = false;
      }
    },
    [createPost, updatePost, onPostCreated]
  );

  const autoSave = useAutoSave({
    key: postId ?? "new_post",
    interval: 15000,
    onPersist,
  });

  /**
   * Public draft surface for the editor — accepts the partial draft fields
   * and forwards them to the underlying autosave with the `body` shape the
   * persistence callback understands.
   */
  const saveDraft = useCallback(
    (draft: {
      content: string;
      title?: string;
      tags?: string[];
      projectId?: string;
      /** Accepts any string for caller convenience; only "es" | "en" is forwarded. */
      locale?: string;
      selectedProviders?: string[];
    }) => {
      const narrowedLocale: "es" | "en" | undefined =
        draft.locale === "es" || draft.locale === "en" ? draft.locale : undefined;

      autoSave.save({
        body: draft.content,
        ...(draft.title !== undefined && { title: draft.title }),
        ...(draft.tags !== undefined && { tags: draft.tags }),
        ...(draft.projectId !== undefined && { projectId: draft.projectId }),
        ...(narrowedLocale !== undefined && { locale: narrowedLocale }),
        ...(draft.selectedProviders !== undefined && {
          selectedProviders: draft.selectedProviders,
        }),
      });
    },
    [autoSave]
  );

  const publishPost = useCallback(
    async (postData: Parameters<typeof createPost.mutateAsync>[0]) => {
      const targetId = persistedPostIdRef.current;
      const result = targetId
        ? await updatePost.mutateAsync({ id: targetId, data: postData })
        : await createPost.mutateAsync(postData);

      autoSave.clearDraft();
      return result;
    },
    [createPost, updatePost, autoSave]
  );

  return {
    ...autoSave,
    saveDraft,
    publishPost,
    isPublishing: createPost.isPending || updatePost.isPending,
  };
}
