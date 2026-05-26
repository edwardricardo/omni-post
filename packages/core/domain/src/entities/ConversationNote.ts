/**
 * @file ConversationNote.ts
 * @description Domain entity representing an internal note attached to a
 *   SocialConversation. Notes are soft-deletable and carry author attribution.
 * @layer domain
 */

import { ok, err, type Result } from "@shared/types";

/**
 * Properties that fully describe a ConversationNote.
 */
export interface ConversationNoteProps {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Input required to create a new ConversationNote.
 */
export interface CreateConversationNoteInput {
  conversationId: string;
  authorId: string;
  body: string;
}

const MAX_BODY_LENGTH = 5000;

/**
 * @class ConversationNote
 * @description Represents an internal team note on a social inbox conversation.
 *   Enforces body length invariants and supports soft-delete.
 */
export class ConversationNote {
  private props: ConversationNoteProps;

  private constructor(props: ConversationNoteProps) {
    this.props = props;
  }

  /**
   * @method create
   * @description Factory method that validates input and produces a new note.
   * @param input - Conversation ID, author ID, and body text
   * @returns Result with the new entity on success, Error on validation failure
   */
  static create(input: CreateConversationNoteInput): Result<ConversationNote, Error> {
    if (!input.body.trim()) {
      return err(new Error("Note body cannot be empty"));
    }
    if (input.body.length > MAX_BODY_LENGTH) {
      return err(new Error(`Note body cannot exceed ${MAX_BODY_LENGTH} characters`));
    }

    const now = new Date();
    return ok(
      new ConversationNote({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        authorId: input.authorId,
        body: input.body.trim(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Rebuilds an entity from persisted data without validation.
   * @param props - The full property set from the database
   * @returns A ConversationNote instance
   */
  static reconstitute(props: ConversationNoteProps): ConversationNote {
    return new ConversationNote(props);
  }

  get id(): string {
    return this.props.id;
  }
  get conversationId(): string {
    return this.props.conversationId;
  }
  get authorId(): string {
    return this.props.authorId;
  }
  get body(): string {
    return this.props.body;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  /**
   * @method softDelete
   * @description Marks this note as deleted without physical removal.
   */
  softDelete(): void {
    const now = new Date();
    this.props = { ...this.props, deletedAt: now, updatedAt: now };
  }

  /**
   * @method toJSON
   * @description Serialises the entity to a plain object.
   */
  toJSON(): ConversationNoteProps {
    return { ...this.props };
  }
}
