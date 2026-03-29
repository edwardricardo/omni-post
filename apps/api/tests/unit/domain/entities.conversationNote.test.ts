/**
 * @file entities.conversationNote.test.ts
 * @description Unit tests for the ConversationNote domain entity.
 * @layer test
 */

import { describe, it, expect } from "vitest";
import { ConversationNote } from "../../../src/domain/entities/ConversationNote.js";

describe("ConversationNote", () => {
  const validInput = {
    conversationId: "conv-1",
    authorId: "author-1",
    body: "Internal note about this conversation",
  };

  describe("create", () => {
    it("creates with valid data", () => {
      const result = ConversationNote.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe("Internal note about this conversation");
        expect(result.value.conversationId).toBe("conv-1");
        expect(result.value.authorId).toBe("author-1");
        expect(result.value.deletedAt).toBeNull();
        expect(result.value.id).toBeTruthy();
        expect(result.value.createdAt).toBeInstanceOf(Date);
        expect(result.value.updatedAt).toBeInstanceOf(Date);
      }
    });

    it("trims whitespace from body", () => {
      const result = ConversationNote.create({ ...validInput, body: "  trimmed note  " });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.body).toBe("trimmed note");
      }
    });

    it("rejects empty body", () => {
      const result = ConversationNote.create({ ...validInput, body: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("empty");
      }
    });

    it("rejects whitespace-only body", () => {
      const result = ConversationNote.create({ ...validInput, body: "   " });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("empty");
      }
    });

    it("rejects body over 5000 characters", () => {
      const longBody = "a".repeat(5001);
      const result = ConversationNote.create({ ...validInput, body: longBody });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("5000");
      }
    });

    it("accepts body at exactly 5000 characters", () => {
      const maxBody = "a".repeat(5000);
      const result = ConversationNote.create({ ...validInput, body: maxBody });
      expect(result.ok).toBe(true);
    });
  });

  describe("softDelete", () => {
    it("sets deletedAt and updatedAt", () => {
      const result = ConversationNote.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const note = result.value;
        const originalUpdatedAt = note.updatedAt;
        expect(note.deletedAt).toBeNull();

        note.softDelete();

        expect(note.deletedAt).toBeInstanceOf(Date);
        expect(note.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
      }
    });
  });

  describe("reconstitute", () => {
    it("rebuilds entity from persisted props", () => {
      const now = new Date();
      const note = ConversationNote.reconstitute({
        id: "note-123",
        conversationId: "conv-1",
        authorId: "author-1",
        body: "Reconstituted note",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      expect(note.id).toBe("note-123");
      expect(note.body).toBe("Reconstituted note");
      expect(note.deletedAt).toBeNull();
    });
  });

  describe("toJSON", () => {
    it("returns correct shape with all properties", () => {
      const result = ConversationNote.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const json = result.value.toJSON();
        expect(json).toHaveProperty("id");
        expect(json).toHaveProperty("conversationId", "conv-1");
        expect(json).toHaveProperty("authorId", "author-1");
        expect(json).toHaveProperty("body", "Internal note about this conversation");
        expect(json).toHaveProperty("createdAt");
        expect(json).toHaveProperty("updatedAt");
        expect(json).toHaveProperty("deletedAt", null);
      }
    });

    it("returns a copy, not the internal reference", () => {
      const result = ConversationNote.create(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const json1 = result.value.toJSON();
        const json2 = result.value.toJSON();
        expect(json1).not.toBe(json2);
        expect(json1).toEqual(json2);
      }
    });
  });
});
