/**
 * Domain Errors Tests
 *
 * Tests for Sprint 3: Domain Layer - Error Classes
 * Following TDD principles - validating domain error implementations.
 */

import { describe, it, expect } from "vitest";
import {
  InvalidValueError,
  InvalidIdError,
  EmptyValueError,
  ValueTooLongError,
  InvalidStateTransitionError,
  EntityNotFoundError,
  InvariantViolationError,
  type DomainErrorType,
} from "../../../src/domain/errors/DomainError.js";

describe("Domain Errors", () => {
  describe("DomainError (base class)", () => {
    // Cannot test abstract class directly, but we test through subclasses
    it("should provide error code on all domain errors", () => {
      const error = new InvalidValueError("field", "value", "message");
      expect(error.code).toBeTruthy();
      expect(typeof error.code).toBe("string");
    });

    it("should provide timestamp on all domain errors", () => {
      const error = new InvalidValueError("field", "value", "message");
      expect(error.timestamp instanceof Date).toBeTruthy();
    });

    it("should set correct error name", () => {
      const error = new InvalidValueError("field", "value", "message");
      expect(error.name).toBe("InvalidValueError");
    });

    it("should be instanceof Error", () => {
      const error = new InvalidValueError("field", "value", "message");
      expect(error instanceof Error).toBeTruthy();
    });

    it("should serialize to JSON correctly", () => {
      const error = new InvalidValueError("email", "invalid-email", "Invalid email format");
      const json = error.toJSON();

      expect(json.name).toBe("InvalidValueError");
      expect(json.code).toBe("INVALID_VALUE");
      expect(json.message).toBe("Invalid email format");
      expect(json.timestamp).toBeTruthy();
      expect(typeof json.timestamp).toBe("string");
    });
  });

  describe("InvalidValueError", () => {
    it("should create error with field, value, and message", () => {
      const error = new InvalidValueError("email", "not-an-email", "Invalid email format");

      expect(error.field).toBe("email");
      expect(error.value).toBe("not-an-email");
      expect(error.message).toBe("Invalid email format");
      expect(error.code).toBe("INVALID_VALUE");
    });

    it("should handle null value", () => {
      const error = new InvalidValueError("name", null, "Name cannot be null");

      expect(error.field).toBe("name");
      expect(error.value).toBe(null);
    });

    it("should handle undefined value", () => {
      const error = new InvalidValueError("age", undefined, "Age is required");

      expect(error.field).toBe("age");
      expect(error.value).toBe(undefined);
    });

    it("should handle complex value objects", () => {
      const complexValue = { nested: { data: [1, 2, 3] } };
      const error = new InvalidValueError("config", complexValue, "Invalid configuration");

      expect(error.value).toEqual(complexValue);
    });
  });

  describe("InvalidIdError", () => {
    it("should create error with idType and message", () => {
      const error = new InvalidIdError("PostId", "invalid-uuid");

      expect(error.idType).toBe("PostId");
      expect(error.message).toBe('Invalid PostId: "invalid-uuid"');
      expect(error.code).toBe("INVALID_ID");
    });

    it("should handle empty string id", () => {
      const error = new InvalidIdError("UserId", "");

      expect(error.idType).toBe("UserId");
      expect(error.message).toBe('Invalid UserId: ""');
    });

    it("should work with different id types", () => {
      const postError = new InvalidIdError("PostId", "bad-post");
      const channelError = new InvalidIdError("ChannelId", "bad-channel");
      const accountError = new InvalidIdError("AccountId", "bad-account");

      expect(postError.idType).toBe("PostId");
      expect(channelError.idType).toBe("ChannelId");
      expect(accountError.idType).toBe("AccountId");
    });
  });

  describe("EmptyValueError", () => {
    it("should create error with field name", () => {
      const error = new EmptyValueError("title");

      expect(error.field).toBe("title");
      expect(error.message).toBe("title cannot be empty");
      expect(error.code).toBe("EMPTY_VALUE");
    });

    it("should work with different field names", () => {
      const titleError = new EmptyValueError("title");
      const bodyError = new EmptyValueError("body");
      const descriptionError = new EmptyValueError("description");

      expect(titleError.message.includes("title")).toBeTruthy();
      expect(bodyError.message.includes("body")).toBeTruthy();
      expect(descriptionError.message.includes("description")).toBeTruthy();
    });
  });

  describe("ValueTooLongError", () => {
    it("should create error with field, maxLength, and actualLength", () => {
      const error = new ValueTooLongError("content", 280, 500);

      expect(error.field).toBe("content");
      expect(error.maxLength).toBe(280);
      expect(error.actualLength).toBe(500);
      expect(error.code).toBe("VALUE_TOO_LONG");
    });

    it("should format message correctly", () => {
      const error = new ValueTooLongError("tweet", 280, 300);

      expect(error.message).toBe("tweet exceeds maximum length of 280 (was 300)");
    });

    it("should handle large numbers", () => {
      const error = new ValueTooLongError("document", 10000, 50000);

      expect(error.maxLength).toBe(10000);
      expect(error.actualLength).toBe(50000);
    });
  });

  describe("InvalidStateTransitionError", () => {
    it("should create error with state transition info", () => {
      const error = new InvalidStateTransitionError("draft", "published", "Post");

      expect(error.fromState).toBe("draft");
      expect(error.toState).toBe("published");
      expect(error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("should format message with entity type", () => {
      const error = new InvalidStateTransitionError("pending", "cancelled", "Order");

      expect(error.message).toBe("Cannot transition Order from pending to cancelled");
    });

    it("should work with different entity types", () => {
      const postError = new InvalidStateTransitionError("draft", "archived", "Post");
      const channelError = new InvalidStateTransitionError("active", "deleted", "Channel");

      expect(postError.message.includes("Post")).toBeTruthy();
      expect(channelError.message.includes("Channel")).toBeTruthy();
    });
  });

  describe("EntityNotFoundError", () => {
    it("should create error with entityType and entityId", () => {
      const error = new EntityNotFoundError("Post", "post-123");

      expect(error.entityType).toBe("Post");
      expect(error.entityId).toBe("post-123");
      expect(error.code).toBe("ENTITY_NOT_FOUND");
    });

    it("should format message correctly", () => {
      const error = new EntityNotFoundError("User", "user-456");

      expect(error.message).toBe('User with id "user-456" not found');
    });

    it("should handle UUID-style ids", () => {
      const error = new EntityNotFoundError("Channel", "550e8400-e29b-41d4-a716-446655440000");

      expect(error.entityId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(error.message.includes("550e8400-e29b-41d4-a716-446655440000")).toBeTruthy();
    });
  });

  describe("InvariantViolationError", () => {
    it("should create error with invariant description", () => {
      const error = new InvariantViolationError("Post must have at least one media item");

      expect(error.invariant).toBe("Post must have at least one media item");
      expect(error.code).toBe("INVARIANT_VIOLATION");
    });

    it("should format message correctly", () => {
      const error = new InvariantViolationError("Channel cannot have negative follower count");

      expect(error.message).toBe("Invariant violated: Channel cannot have negative follower count");
    });

    it("should handle complex invariant descriptions", () => {
      const error = new InvariantViolationError(
        "Scheduled time must be at least 5 minutes in the future"
      );

      expect(error.message.includes("Scheduled time")).toBeTruthy();
      expect(error.invariant.includes("5 minutes")).toBeTruthy();
    });
  });

  describe("Error type checking", () => {
    it("should allow type narrowing with instanceof", () => {
      const errors: DomainErrorType[] = [
        new InvalidValueError("field", "value", "msg"),
        new InvalidIdError("PostId", "invalid"),
        new EmptyValueError("title"),
        new ValueTooLongError("content", 100, 200),
        new InvalidStateTransitionError("a", "b", "Entity"),
        new EntityNotFoundError("Post", "123"),
        new InvariantViolationError("invariant"),
      ];

      for (const error of errors) {
        // All should be instanceof Error
        expect(error instanceof Error).toBeTruthy();

        // Type narrowing should work
        if (error instanceof InvalidValueError) {
          expect(error.field).toBeTruthy();
        }
        if (error instanceof InvalidIdError) {
          expect(error.idType).toBeTruthy();
        }
        if (error instanceof EmptyValueError) {
          expect(error.field).toBeTruthy();
        }
        if (error instanceof ValueTooLongError) {
          expect(error.maxLength !== undefined).toBeTruthy();
        }
        if (error instanceof InvalidStateTransitionError) {
          expect(error.fromState).toBeTruthy();
        }
        if (error instanceof EntityNotFoundError) {
          expect(error.entityId).toBeTruthy();
        }
        if (error instanceof InvariantViolationError) {
          expect(error.invariant).toBeTruthy();
        }
      }
    });

    it("should all have unique error codes", () => {
      const errors = [
        new InvalidValueError("f", "v", "m"),
        new InvalidIdError("PostId", "x"),
        new EmptyValueError("f"),
        new ValueTooLongError("f", 1, 2),
        new InvalidStateTransitionError("a", "b", "E"),
        new EntityNotFoundError("E", "1"),
        new InvariantViolationError("i"),
      ];

      const codes = errors.map((e) => e.code);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(codes.length);
    });
  });

  describe("Stack trace preservation", () => {
    it("should preserve stack trace", () => {
      const error = new InvalidValueError("field", "value", "message");

      expect(error.stack).toBeTruthy();
      expect(error.stack.includes("InvalidValueError")).toBeTruthy();
    });

    it("should show correct origin in stack trace", () => {
      function throwInvalidValue(): never {
        throw new InvalidValueError("test", "value", "Test error");
      }

      try {
        throwInvalidValue();
      } catch (error) {
        expect(error instanceof InvalidValueError).toBeTruthy();
        expect((error as InvalidValueError).stack?.includes("throwInvalidValue")).toBeTruthy();
      }
    });
  });
});
