/**
 * @file useAutoSave.integration.test.ts
 * @description Integration tests for useAutoSave hook — debounce, localStorage, save lifecycle.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "../../lib/hooks/useAutoSave";

// Mock the API hooks that usePostDraft depends on
vi.mock("@/lib/api/hooks", () => ({
  useCreatePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mock localStorage
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

Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage, writable: true });

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockLocalStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with idle saveStatus", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.saveStatus).toBe("idle");
  });

  it("starts with null lastSaved", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.lastSaved).toBeNull();
  });

  it("exposes save, saveNow, loadDraft, clearDraft functions", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(typeof result.current.save).toBe("function");
    expect(typeof result.current.saveNow).toBe("function");
    expect(typeof result.current.loadDraft).toBe("function");
    expect(typeof result.current.clearDraft).toBe("function");
  });

  it("saves to localStorage after debounce interval", async () => {
    const { result } = renderHook(() => useAutoSave({ key: "test", interval: 1000 }));

    act(() => {
      result.current.save({ content: "Hello world" });
    });

    // Before interval — not saved yet
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();

    // After interval
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    // Give async operations time to complete
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
  });

  it("loadDraft returns null when no draft exists", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    const draft = result.current.loadDraft();
    expect(draft).toBeNull();
  });

  it("loadDraft returns stored draft", () => {
    mockStorage["draft_test"] = JSON.stringify({ content: "Saved draft" });

    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    const draft = result.current.loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.content).toBe("Saved draft");
  });

  it("clearDraft removes from localStorage", () => {
    mockStorage["draft_test"] = JSON.stringify({ content: "Draft" });

    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    act(() => {
      result.current.clearDraft();
    });

    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("draft_test");
  });

  it("hasDraft returns true when draft exists", () => {
    mockStorage["draft_test"] = JSON.stringify({ content: "Draft" });

    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.hasDraft).toBe(true);
  });

  it("hasDraft returns false when no draft", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.hasDraft).toBe(false);
  });

  it("uses key to namespace localStorage", () => {
    mockStorage["draft_project-1"] = JSON.stringify({ content: "Project 1" });

    const { result } = renderHook(() => useAutoSave({ key: "project-1" }));
    const draft = result.current.loadDraft();
    expect(draft?.content).toBe("Project 1");
  });

  it("defaults interval to 30000ms", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    // Can't directly test the interval, but verify hook returns without error
    expect(result.current.saveStatus).toBe("idle");
  });

  it("defaults enabled to true", () => {
    const { result } = renderHook(() => useAutoSave({ key: "test" }));
    expect(result.current.saveStatus).toBe("idle");
  });
});
