#!/usr/bin/env tsx
/**
 * Unit Tests for BaseService
 * Testing all error handling, validation, and logging functionality
 *
 * Converted to node:test standard
 *
 * @file BaseService.test.ts
 * @description Tests for BaseService
 * @layer infrastructure
 */

import { describe, it, beforeAll, expect } from "vitest";
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

  beforeAll(() => {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toStrictEqual({ data: "success" });
      }
    });

    it("should return err() with error message on failure", async () => {
      const result = await service.testExecuteWithErrorHandling(
        { operation: "testOperation", userId: "user123" },
        async () => {
          throw new Error("Test error");
        }
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toMatch(/Test error/);
      }
    });
  });

  describe("validateRequired", () => {
    it("should not throw when all values are present", () => {
      expect(() => {
        service.testValidateRequired({
          userId: "user123",
          accountId: "account456",
          operation: "test",
        });
      }).not.toThrow();
    });

    it("should throw when values are null or undefined", () => {
      expect(() => {
        service.testValidateRequired({
          userId: "user123",
          accountId: null,
          operation: undefined,
        });
      }).toThrow(/accountId/);
    });

    it("should include custom error message", () => {
      expect(() => {
        service.testValidateRequired({ field: null }, "Custom validation error");
      }).toThrow(/Custom validation error/);
    });
  });
});
