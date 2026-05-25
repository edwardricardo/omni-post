/**
 * @file PrismaConversationNoteRepository.ts
 * @description Infrastructure adapter implementing ConversationNoteRepository
 *   using Prisma ORM. Maps between Prisma database records and ConversationNote
 *   domain entities.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type { ConversationNoteRepository } from "@core/domain/repositories/ConversationNoteRepository.js";
import { ConversationNote } from "@core/domain/entities/ConversationNote.js";

/**
 * Raw Prisma row shape for type-safe mapping.
 */
interface PrismaConversationNoteRow {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * @class PrismaConversationNoteRepository
 * @description Adapter for ConversationNoteRepository using Prisma.
 */
export class PrismaConversationNoteRepository implements ConversationNoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Finds a note by its unique identifier.
   * @param id - The note ID
   * @returns Result containing entity on success, Error if not found
   */
  async findById(id: string): Promise<Result<ConversationNote, Error>> {
    try {
      const row = await this.prisma.conversationNote.findUnique({
        where: { id },
      });

      if (!row) {
        return err(new Error(`ConversationNote not found: ${id}`));
      }

      return ok(this.toDomain(row as PrismaConversationNoteRow));
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to find ConversationNote ${id}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findByConversation
   * @description Returns all non-deleted notes for a conversation, newest first.
   * @param conversationId - The conversation ID
   * @returns Array of ConversationNote domain entities
   */
  async findByConversation(conversationId: string): Promise<ConversationNote[]> {
    const rows = await this.prisma.conversationNote.findMany({
      where: {
        conversationId,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    return (rows as PrismaConversationNoteRow[]).map((row) => this.toDomain(row));
  }

  /**
   * @method save
   * @description Persists a note via upsert (create if new, update if exists).
   * @param note - The ConversationNote domain entity
   * @returns Result<void, Error>
   */
  async save(note: ConversationNote): Promise<Result<void, Error>> {
    try {
      const data = {
        conversationId: note.conversationId,
        authorId: note.authorId,
        body: note.body,
        updatedAt: note.updatedAt,
        ...(note.deletedAt !== null && { deletedAt: note.deletedAt }),
      };

      await this.prisma.conversationNote.upsert({
        where: { id: note.id },
        create: {
          id: note.id,
          ...data,
          createdAt: note.createdAt,
        },
        update: data,
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to save ConversationNote: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method softDelete
   * @description Sets deletedAt on a note without physical removal.
   * @param id - The note ID
   * @returns Result<void, Error>
   */
  async softDelete(id: string): Promise<Result<void, Error>> {
    try {
      const existing = await this.prisma.conversationNote.findUnique({
        where: { id },
      });

      if (!existing) {
        return err(new Error(`ConversationNote not found: ${id}`));
      }

      await this.prisma.conversationNote.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return ok(undefined);
    } catch (error: unknown) {
      return err(
        new Error(
          `Failed to soft-delete ConversationNote ${id}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method toDomain
   * @description Maps a Prisma row to a ConversationNote domain entity.
   */
  private toDomain(row: PrismaConversationNoteRow): ConversationNote {
    return ConversationNote.reconstitute({
      id: row.id,
      conversationId: row.conversationId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }
}
