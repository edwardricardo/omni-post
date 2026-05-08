/**
 * @file useAutoSave.integration.test.ts
 * @description Integration tests for `useAutoSave` and `usePostDraft` covering
 *              debounce + localStorage offline cache + the canonical Pattern
 *              Lazy server-persistence flow (skip empty body, POST first save,
 *              PATCH subsequent saves, single-flight create, status lifecycle).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave, usePostDraft } from "../../lib/hooks/useAutoSave";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
let createIsPending = false;
let updateIsPending = false;

vi.mock("@/lib/api/hooks", () => ({
  useCreatePost: () => ({ mutateAsync: createMutateAsync, isPending: createIsPending }),
  useUpdatePost: () => ({ mutateAsync: updateMutateAsync, isPending: updateIsPending }),
}));

const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  }),
  length: 0,
  key: vi.fn(() => null),
};

// jsdom provides `window` and a real localStorage; replace just localStorage
// (on both `globalThis` for backward compat and on the `window` object the
// hook actually reads from) with a spy-friendly mock so we can assert calls.
Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});
Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockLocalStorage.clear();
  createIsPending = false;
  updateIsPending = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave", () => {
  it("starts with idle status, null lastSaved, and exposes the public surface", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.lastSaved).toBeNull();
    expect(typeof result.current.save).toBe("function");
    expect(typeof result.current.saveNow).toBe("function");
    expect(typeof result.current.loadDraft).toBe("function");
    expect(typeof result.current.clearDraft).toBe("function");
  });

  it("writes to localStorage after the debounce interval", async () => {
    const { result } = renderHook(() => useAutoSave({ key: "test", interval: 1000 }));

    act(() => {
      result.current.save({ body: "Hello" });
    });
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      "draft_test",
      expect.stringContaining('"body":"Hello"')
    );
  });

  it("loads, clears, and reports presence of localStorage drafts", () => {
    mockStorage["draft_post-1"] = JSON.stringify({ body: "Saved" });
    const { result } = renderHook(() => useAutoSave({ key: "post-1" }));

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.loadDraft()?.body).toBe("Saved");

    act(() => result.current.clearDraft());
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("draft_post-1");
  });

  it("calls onPersist after the localStorage write and transitions saveStatus", async () => {
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave({ key: "test", interval: 500, onPersist }));

    act(() => {
      result.current.save({ body: "Hello" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
    expect(onPersist).toHaveBeenCalledWith({ body: "Hello" });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it("transitions saveStatus to error when onPersist throws", async () => {
    const onPersist = vi.fn().mockRejectedValue(new Error("boom"));
    const onSaveResult = vi.fn();
    const { result } = renderHook(() =>
      useAutoSave({ key: "test", interval: 500, onPersist, onSaveResult })
    );

    act(() => {
      result.current.save({ body: "Hello" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.saveStatus).toBe("error");
    expect(onSaveResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("saveNow flushes the debounce immediately", async () => {
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave({ key: "test", interval: 60_000, onPersist }));

    act(() => {
      result.current.save({ body: "Hello" });
    });

    await act(async () => {
      await result.current.saveNow();
    });

    expect(onPersist).toHaveBeenCalledTimes(1);
  });
});

describe("usePostDraft (Pattern Lazy)", () => {
  it("skips server persistence when body is empty", async () => {
    const { result } = renderHook(() => usePostDraft());

    act(() => {
      result.current.saveDraft({ content: "   " });
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(mockLocalStorage.setItem).toHaveBeenCalled(); // localStorage still runs
  });

  it("issues POST /posts on first save with body and projectId", async () => {
    createMutateAsync.mockResolvedValue({ ok: true, data: { id: "new-post-id" } });
    const onPostCreated = vi.fn();
    const { result } = renderHook(() => usePostDraft(undefined, onPostCreated));

    act(() => {
      result.current.saveDraft({ content: "Hello world", projectId: "proj-1", locale: "en" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", body: "Hello world", locale: "en" })
    );
    expect(onPostCreated).toHaveBeenCalledWith("new-post-id");
  });

  it("PATCHes /posts/:id on subsequent saves once the post exists", async () => {
    updateMutateAsync.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => usePostDraft("existing-id"));

    act(() => {
      result.current.saveDraft({ content: "Updated", title: "T" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: "existing-id",
      data: { body: "Updated", title: "T" },
    });
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("never creates without a projectId in the draft payload", async () => {
    const { result } = renderHook(() => usePostDraft());

    act(() => {
      result.current.saveDraft({ content: "Has body but no project" });
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(mockLocalStorage.setItem).toHaveBeenCalled();
  });
});
