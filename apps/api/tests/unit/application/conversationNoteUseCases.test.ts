/**
 * @file conversationNoteUseCases.test.ts
 * @description Unit tests for ConversationNote use cases: Add, Delete, List.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AddConversationNoteUseCase } from "@core/application/inbox/AddConversationNoteUseCase.js";
import { DeleteConversationNoteUseCase } from "@core/application/inbox/DeleteConversationNoteUseCase.js";
import { ListConversationNotesQuery } from "@core/application/inbox/ListConversationNotesQuery.js";
import { ConversationNote } from "@core/domain/entities/ConversationNote.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeNoteRepo() {
  return {
    findById: vi.fn(),
    findByConversation: vi.fn(),
    save: vi.fn(),
    softDelete: vi.fn(),
  };
}

function makeUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
}

function makeTestNote(
  overrides: Partial<{ id: string; conversationId: string; authorId: string; body: string }> = {}
) {
  const now = new Date("2024-06-01T00:00:00Z");
  return ConversationNote.reconstitute({
    id: overrides.id ?? "note-001",
    conversationId: overrides.conversationId ?? "conv-001",
    authorId: overrides.authorId ?? "author-001",
    body: overrides.body ?? "Test note body",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

// ============================================================================
// AddConversationNoteUseCase
// ============================================================================

describe("AddConversationNoteUseCase", () => {
  let noteRepo: ReturnType<typeof makeNoteRepo>;
  let unitOfWork: ReturnType<typeof makeUnitOfWork>;
  let useCase: AddConversationNoteUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    noteRepo = makeNoteRepo();
    unitOfWork = makeUnitOfWork();
    useCase = new AddConversationNoteUseCase(noteRepo, unitOfWork);
  });

  it("creates a note successfully", async () => {
    noteRepo.save.mockResolvedValue({ ok: true, value: undefined });

    const result = await useCase.execute({
      conversationId: "conv-001",
      authorId: "author-001",
      authorName: "Test Author",
      accountId: "account-001",
      body: "A new internal note",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeTruthy();
    }
    expect(noteRepo.save).toHaveBeenCalledOnce();
    expect(unitOfWork.executeInTransaction).toHaveBeenCalledOnce();
  });

  it("returns validation error for empty body", async () => {
    const result = await useCase.execute({
      conversationId: "conv-001",
      authorId: "author-001",
      authorName: "Test Author",
      accountId: "account-001",
      body: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.message).toContain("empty");
    }
    expect(noteRepo.save).not.toHaveBeenCalled();
  });

  it("returns validation error for body over 5000 chars", async () => {
    const result = await useCase.execute({
      conversationId: "conv-001",
      authorId: "author-001",
      authorName: "Test Author",
      accountId: "account-001",
      body: "x".repeat(5001),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(noteRepo.save).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR when save fails", async () => {
    noteRepo.save.mockResolvedValue({ ok: false, error: new Error("DB error") });

    const result = await useCase.execute({
      conversationId: "conv-001",
      authorId: "author-001",
      authorName: "Test Author",
      accountId: "account-001",
      body: "Valid note",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("works without unit of work", async () => {
    const useCaseNoUow = new AddConversationNoteUseCase(noteRepo);
    noteRepo.save.mockResolvedValue({ ok: true, value: undefined });

    const result = await useCaseNoUow.execute({
      conversationId: "conv-001",
      authorId: "author-001",
      authorName: "Test Author",
      accountId: "account-001",
      body: "Note without UoW",
    });

    expect(result.ok).toBe(true);
    expect(unitOfWork.executeInTransaction).not.toHaveBeenCalled();
  });
});

// ============================================================================
// DeleteConversationNoteUseCase
// ============================================================================

describe("DeleteConversationNoteUseCase", () => {
  let noteRepo: ReturnType<typeof makeNoteRepo>;
  let unitOfWork: ReturnType<typeof makeUnitOfWork>;
  let useCase: DeleteConversationNoteUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    noteRepo = makeNoteRepo();
    unitOfWork = makeUnitOfWork();
    useCase = new DeleteConversationNoteUseCase(noteRepo, unitOfWork);
  });

  it("deletes a note when author matches", async () => {
    const note = makeTestNote({ authorId: "author-001" });
    noteRepo.findById.mockResolvedValue({ ok: true, value: note });
    noteRepo.save.mockResolvedValue({ ok: true, value: undefined });

    const result = await useCase.execute({
      noteId: "note-001",
      authorId: "author-001",
    });

    expect(result.ok).toBe(true);
    expect(noteRepo.save).toHaveBeenCalledOnce();
  });

  it("returns FORBIDDEN when author does not match", async () => {
    const note = makeTestNote({ authorId: "author-001" });
    noteRepo.findById.mockResolvedValue({ ok: true, value: note });

    const result = await useCase.execute({
      noteId: "note-001",
      authorId: "different-author",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.message).toContain("author");
    }
    expect(noteRepo.save).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when note does not exist", async () => {
    noteRepo.findById.mockResolvedValue({ ok: false, error: new Error("Not found") });

    const result = await useCase.execute({
      noteId: "nonexistent",
      authorId: "author-001",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("returns INTERNAL_ERROR when save fails during delete", async () => {
    const note = makeTestNote({ authorId: "author-001" });
    noteRepo.findById.mockResolvedValue({ ok: true, value: note });
    noteRepo.save.mockResolvedValue({ ok: false, error: new Error("DB error") });

    const result = await useCase.execute({
      noteId: "note-001",
      authorId: "author-001",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });
});

// ============================================================================
// ListConversationNotesQuery
// ============================================================================

describe("ListConversationNotesQuery", () => {
  let noteRepo: ReturnType<typeof makeNoteRepo>;
  let query: ListConversationNotesQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    noteRepo = makeNoteRepo();
    query = new ListConversationNotesQuery(noteRepo);
  });

  it("returns notes as DTOs", async () => {
    const note1 = makeTestNote({ id: "note-1", body: "First note" });
    const note2 = makeTestNote({ id: "note-2", body: "Second note" });
    noteRepo.findByConversation.mockResolvedValue([note1, note2]);

    const result = await query.execute({ conversationId: "conv-001" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.id).toBe("note-1");
      expect(result.value[0]?.body).toBe("First note");
      expect(result.value[1]?.id).toBe("note-2");
      // DTO should not include deletedAt
      expect(result.value[0]).not.toHaveProperty("deletedAt");
    }
  });

  it("returns empty array when no notes exist", async () => {
    noteRepo.findByConversation.mockResolvedValue([]);

    const result = await query.execute({ conversationId: "conv-001" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("returns INTERNAL_ERROR when repository throws", async () => {
    noteRepo.findByConversation.mockRejectedValue(new Error("Connection failed"));

    const result = await query.execute({ conversationId: "conv-001" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });
});
