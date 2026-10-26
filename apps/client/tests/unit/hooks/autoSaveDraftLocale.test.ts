/**
 * @file autoSaveDraftLocale.test.ts
 * @description `useAutoSave.loadDraft` reads a browser draft through the content-locale guard: a
 *              draft saved by an earlier build in a language outside CONTENT_LOCALES comes back
 *              without that language, and one in es keeps it.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoSave } from "@/lib/hooks/useAutoSave";

vi.mock("@/lib/api/hooks", () => ({
  useCreateDraftViaSaga: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const DRAFT_KEY = "draft_post-1";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useAutoSave.loadDraft — the draft's language", () => {
  it("keeps a stored draft's language when it is a content locale", () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ body: "Hola", locale: "es" }));
    const { result } = renderHook(() => useAutoSave({ key: "post-1" }));

    const draft = result.current.loadDraft();

    expect(draft).toEqual({ body: "Hola", locale: "es" });
  });

  it("drops a stored draft's language outside CONTENT_LOCALES and keeps the rest of the draft", () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ body: "Olá", title: "Lançamento", locale: "pt" })
    );
    const { result } = renderHook(() => useAutoSave({ key: "post-1" }));

    const draft = result.current.loadDraft();

    expect(draft).toEqual({ body: "Olá", title: "Lançamento" });
  });
});
