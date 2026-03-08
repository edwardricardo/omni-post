/**
 * Domain Errors Tests
 *
 * Tests for Sprint 3: Domain Layer - Error Classes
 * Following TDD principles - validating domain error implementations.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
      assert.ok(error.code);
      assert.equal(typeof error.code, "string");
    });

    it("should provide timestamp on all domain errors", () => {
      const error = new InvalidValueError("field", "value", "message");
      assert.ok(error.timestamp instanceof Date);
    });

    it("should set correct error name", () => {
      const error = new InvalidValueError("field", "value", "message");
      assert.equal(error.name, "InvalidValueError");
    });

    it("should be instanceof Error", () => {
      const error = new InvalidValueError("field", "value", "message");
      assert.ok(error instanceof Error);
    });

    it("should serialize to JSON correctly", () => {
      const error = new InvalidValueError("email", "invalid-email", "Invalid email format");
      const json = error.toJSON();

      assert.equal(json.name, "InvalidValueError");
      assert.equal(json.code, "INVALID_VALUE");
      assert.equal(json.message, "Invalid email format");
      assert.ok(json.timestamp);
      assert.equal(typeof json.timestamp, "string");
    });
  });

  describe("InvalidValueError", () => {
    it("should create error with field, value, and message", () => {
      const error = new InvalidValueError("email", "not-an-email", "Invalid email format");

      assert.equal(error.field, "email");
      assert.equal(error.value, "not-an-email");
      assert.equal(error.message, "Invalid email format");
      assert.equal(error.code, "INVALID_VALUE");
    });

    it("should handle null value", () => {
      const error = new InvalidValueError("name", null, "Name cannot be null");

      assert.equal(error.field, "name");
      assert.strictEqual(error.value, null);
    });

    it("should handle undefined value", () => {
      const error = new InvalidValueError("age", undefined, "Age is required");

      assert.equal(error.field, "age");
      assert.strictEqual(error.value, undefined);
    });

    it("should handle complex value objects", () => {
      const complexValue = { nested: { data: [1, 2, 3] } };
      const error = new InvalidValueError("config", complexValue, "Invalid configuration");

      assert.deepEqual(error.value, complexValue);
    });
  });

  describe("InvalidIdError", () => {
    it("should create error with idType and message", () => {
      const error = new InvalidIdError("PostId", "invalid-uuid");

      assert.equal(error.idType, "PostId");
      assert.equal(error.message, 'Invalid PostId: "invalid-uuid"');
      assert.equal(error.code, "INVALID_ID");
    });

    it("should handle empty string id", () => {
      const error = new InvalidIdError("UserId", "");

      assert.equal(error.idType, "UserId");
      assert.equal(error.message, 'Invalid UserId: ""');
    });

    it("should work with different id types", () => {
      const postError = new InvalidIdError("PostId", "bad-post");
      const channelError = new InvalidIdError("ChannelId", "bad-channel");
      const accountError = new InvalidIdError("AccountId", "bad-account");

      assert.equal(postError.idType, "PostId");
      assert.equal(channelError.idType, "ChannelId");
      assert.equal(accountError.idType, "AccountId");
    });
  });

  describe("EmptyValueError", () => {
    it("should create error with field name", () => {
      const error = new EmptyValueError("title");

      assert.equal(error.field, "title");
      assert.equal(error.message, "title cannot be empty");
      assert.equal(error.code, "EMPTY_VALUE");
    });

    it("should work with different field names", () => {
      const titleError = new EmptyValueError("title");
      const bodyError = new EmptyValueError("body");
      const descriptionError = new EmptyValueError("description");

      assert.ok(titleError.message.includes("title"));
      assert.ok(bodyError.message.includes("body"));
      assert.ok(descriptionError.message.includes("description"));
    });
  });

  describe("ValueTooLongError", () => {
    it("should create error with field, maxLength, and actualLength", () => {
      const error = new ValueTooLongError("content", 280, 500);

      assert.equal(error.field, "content");
      assert.equal(error.maxLength, 280);
      assert.equal(error.actualLength, 500);
      assert.equal(error.code, "VALUE_TOO_LONG");
    });

    it("should format message correctly", () => {
      const error = new ValueTooLongError("tweet", 280, 300);

      assert.equal(error.message, "tweet exceeds maximum length of 280 (was 300)");
    });

    it("should handle large numbers", () => {
      const error = new ValueTooLongError("document", 10000, 50000);

      assert.equal(error.maxLength, 10000);
      assert.equal(error.actualLength, 50000);
    });
  });

  describe("InvalidStateTransitionError", () => {
    it("should create error with state transition info", () => {
      const error = new InvalidStateTransitionError("draft", "published", "Post");

      assert.equal(error.fromState, "draft");
      assert.equal(error.toState, "published");
      assert.equal(error.code, "INVALID_STATE_TRANSITION");
    });

    it("should format message with entity type", () => {
      const error = new InvalidStateTransitionError("pending", "cancelled", "Order");

      assert.equal(error.message, "Cannot transition Order from pending to cancelled");
    });

    it("should work with different entity types", () => {
      const postError = new InvalidStateTransitionError("draft", "archived", "Post");
      const channelError = new InvalidStateTransitionError("active", "deleted", "Channel");

      assert.ok(postError.message.includes("Post"));
      assert.ok(channelError.message.includes("Channel"));
    });
  });

  describe("EntityNotFoundError", () => {
    it("should create error with entityType and entityId", () => {
      const error = new EntityNotFoundError("Post", "post-123");

      assert.equal(error.entityType, "Post");
      assert.equal(error.entityId, "post-123");
      assert.equal(error.code, "ENTITY_NOT_FOUND");
    });

    it("should format message correctly", () => {
      const error = new EntityNotFoundError("User", "user-456");

      assert.equal(error.message, 'User with id "user-456" not found');
    });

    it("should handle UUID-style ids", () => {
      const error = new EntityNotFoundError("Channel", "550e8400-e29b-41d4-a716-446655440000");

      assert.equal(error.entityId, "550e8400-e29b-41d4-a716-446655440000");
      assert.ok(error.message.includes("550e8400-e29b-41d4-a716-446655440000"));
    });
  });

  describe("InvariantViolationError", () => {
    it("should create error with invariant description", () => {
      const error = new InvariantViolationError("Post must have at least one media item");

      assert.equal(error.invariant, "Post must have at least one media item");
      assert.equal(error.code, "INVARIANT_VIOLATION");
    });

    it("should format message correctly", () => {
      const error = new InvariantViolationError("Channel cannot have negative follower count");

      assert.equal(
        error.message,
        "Invariant violated: Channel cannot have negative follower count"
      );
    });

    it("should handle complex invariant descriptions", () => {
      const error = new InvariantViolationError(
        "Scheduled time must be at least 5 minutes in the future"
      );

      assert.ok(error.message.includes("Scheduled time"));
      assert.ok(error.invariant.includes("5 minutes"));
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
        assert.ok(error instanceof Error);

        // Type narrowing should work
        if (error instanceof InvalidValueError) {
          assert.ok(error.field);
        }
        if (error instanceof InvalidIdError) {
          assert.ok(error.idType);
        }
        if (error instanceof EmptyValueError) {
          assert.ok(error.field);
        }
        if (error instanceof ValueTooLongError) {
          assert.ok(error.maxLength !== undefined);
        }
        if (error instanceof InvalidStateTransitionError) {
          assert.ok(error.fromState);
        }
        if (error instanceof EntityNotFoundError) {
          assert.ok(error.entityId);
        }
        if (error instanceof InvariantViolationError) {
          assert.ok(error.invariant);
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

      assert.equal(uniqueCodes.size, codes.length, "All error codes should be unique");
    });
  });

  describe("Stack trace preservation", () => {
    it("should preserve stack trace", () => {
      const error = new InvalidValueError("field", "value", "message");

      assert.ok(error.stack);
      assert.ok(error.stack.includes("InvalidValueError"));
    });

    it("should show correct origin in stack trace", () => {
      function throwInvalidValue(): never {
        throw new InvalidValueError("test", "value", "Test error");
      }

      try {
        throwInvalidValue();
      } catch (error) {
        assert.ok(error instanceof InvalidValueError);
        assert.ok((error as InvalidValueError).stack?.includes("throwInvalidValue"));
      }
    });
  });
});
