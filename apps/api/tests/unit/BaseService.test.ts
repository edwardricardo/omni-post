#!/usr/bin/env tsx
/**
 * Unit Tests for BaseService
 * Testing all error handling, validation, and logging functionality
 *
 * Converted to node:test standard
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { BaseService, type ServiceContext } from "../../src/services/BaseService.js";
import { isOk, isErr } from "@shared/types";

// Test implementation of BaseService
class TestService extends BaseService {
  constructor() {
    super("TestService");
  }

  // Expose protected methods for testing
  public async testExecuteWithErrorHandling<T>(
    context: Omit<ServiceContext, "serviceName">,
    operation: () => Promise<T>
  ) {
    return this.executeWithErrorHandling(context, operation);
  }

  public testValidateRequired(values: Record<string, unknown>, errorMessage?: string) {
    return this.validateRequired(values, errorMessage);
  }
}

describe("BaseService", () => {
  let service: TestService;

  before(() => {
    service = new TestService();
  });

  describe("executeWithErrorHandling", () => {
    it("should return ok() with correct value on success", async () => {
      const result = await service.testExecuteWithErrorHandling(
        { operation: "testOperation", userId: "user123" },
        async () => {
          return { data: "success" };
        }
      );

      assert.strictEqual(isOk(result), true, "Result should be ok()");
      if (isOk(result)) {
        assert.deepStrictEqual(result.value, { data: "success" });
      }
    });

    it("should return err() with error message on failure", async () => {
      const result = await service.testExecuteWithErrorHandling(
        { operation: "testOperation", userId: "user123" },
        async () => {
          throw new Error("Test error");
        }
      );

      assert.strictEqual(isErr(result), true, "Result should be err()");
      if (isErr(result)) {
        assert.match(result.error, /Test error/, "Error message should include 'Test error'");
      }
    });
  });

  describe("validateRequired", () => {
    it("should not throw when all values are present", () => {
      assert.doesNotThrow(() => {
        service.testValidateRequired({
          userId: "user123",
          accountId: "account456",
          operation: "test",
        });
      });
    });

    it("should throw when values are null or undefined", () => {
      assert.throws(
        () => {
          service.testValidateRequired({
            userId: "user123",
            accountId: null,
            operation: undefined,
          });
        },
        (error: Error) => {
          return error.message.includes("accountId") && error.message.includes("operation");
        },
        "Should throw with missing field names"
      );
    });

    it("should include custom error message", () => {
      assert.throws(
        () => {
          service.testValidateRequired({ field: null }, "Custom validation error");
        },
        (error: Error) => {
          return error.message.includes("Custom validation error");
        }
      );
    });
  });
});
