/**
 * Type Utilities - Comprehensive Test Suite
 *
 * Tests validate TypeScript strict mode utility functions including:
 * 1. removeUndefinedProperties - exactOptionalPropertyTypes compliance
 * 2. conditionalProperty - Safe conditional property spreading
 * 3. extractDefinedProperties - Filtering with type safety
 *
 * Key Business Rules:
 * - undefined values must be removed for exactOptionalPropertyTypes
 * - null, 0, false, "" are preserved (not treated as "empty")
 * - Conditional properties return empty object when false (for spread operator)
 * - Only explicitly allowed keys are extracted from source objects
 *
 * No database dependencies - pure logic functions
 */

import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  removeUndefinedProperties,
  conditionalProperty,
  extractDefinedProperties,
} from "../../src/utils/typeUtils";

describe("typeUtils", () => {
  describe("removeUndefinedProperties", () => {
    describe("Basic Functionality", () => {
      it("should remove undefined values", () => {
        const obj = {
          name: "John",
          age: undefined,
          email: "john@example.com",
          phone: undefined,
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(result.name, "John");
        assert.strictEqual(result.email, "john@example.com");
        assert.ok(!("age" in result), "Should remove undefined age");
        assert.ok(!("phone" in result), "Should remove undefined phone");
      });

      it("should keep null values", () => {
        const obj = {
          name: "John",
          age: null,
          email: "john@example.com",
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(result.age, null);
        assert.ok("age" in result, "Null property should be present in result");
      });

      it("should keep zero values", () => {
        const obj = {
          count: 0,
          value: undefined,
          enabled: false,
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(result.count, 0);
        assert.strictEqual(result.enabled, false);
        assert.ok(!("value" in result), "Should remove undefined value");
      });

      it("should handle empty object", () => {
        const obj = {};

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(Object.keys(result).length, 0);
      });

      it("should handle all undefined properties", () => {
        const obj = {
          a: undefined,
          b: undefined,
          c: undefined,
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(Object.keys(result).length, 0);
      });

      it("should handle no undefined properties", () => {
        const obj = {
          name: "Alice",
          age: 30,
          active: true,
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(Object.keys(result).length, 3);
        assert.strictEqual(result.name, "Alice");
        assert.strictEqual(result.age, 30);
        assert.strictEqual(result.active, true);
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty string", () => {
        const obj = {
          name: "",
          age: undefined,
        };

        const result = removeUndefinedProperties(obj);

        assert.strictEqual(result.name, "");
        assert.ok("name" in result, "Empty string property should be present");
        assert.ok(!("age" in result), "Should remove undefined age");
      });

      it("should handle nested objects", () => {
        const obj = {
          user: { name: "John", age: undefined },
          settings: undefined,
        };

        const result = removeUndefinedProperties(obj);

        assert.ok(result.user !== undefined);
        assert.ok(!("settings" in result));
      });

      it("should handle arrays", () => {
        const obj = {
          items: [1, 2, 3],
          tags: undefined,
        };

        const result = removeUndefinedProperties(obj);

        assert.ok(Array.isArray(result.items));
        assert.strictEqual(result.items?.length, 3);
        assert.ok(!("tags" in result));
      });
    });
  });

  describe("conditionalProperty", () => {
    describe("Basic Functionality", () => {
      it("should return value when condition is true", () => {
        const result = conditionalProperty(true, { key: "value" });

        assert.strictEqual(typeof result, "object");
        assert.strictEqual((result as any).key, "value");
      });

      it("should return empty object when condition is false", () => {
        const result = conditionalProperty(false, { key: "value" });

        assert.strictEqual(typeof result, "object");
        assert.strictEqual(Object.keys(result).length, 0);
      });
    });

    describe("Spread Operator Integration", () => {
      it("should work with spread operator (true case)", () => {
        const base = { id: 1, name: "Test" };
        const optional = conditionalProperty(true, { extra: "data" });

        const merged = { ...base, ...optional };

        assert.strictEqual(merged.id, 1);
        assert.strictEqual((merged as any).extra, "data");
      });

      it("should work with spread operator (false case)", () => {
        const base = { id: 1, name: "Test" };
        const optional = conditionalProperty(false, { extra: "data" });

        const merged = { ...base, ...optional };

        assert.strictEqual(merged.id, 1);
        assert.ok(!("extra" in merged));
        assert.strictEqual(Object.keys(merged).length, 2);
      });
    });

    describe("Different Value Types", () => {
      it("should handle string values", () => {
        const result = conditionalProperty(true, "test-value");

        assert.strictEqual(result, "test-value");
      });

      it("should handle number values", () => {
        const result = conditionalProperty(true, 42);

        assert.strictEqual(result, 42);
      });

      it("should handle null", () => {
        const result = conditionalProperty(true, null);

        assert.strictEqual(result, null);
      });

      it("should handle undefined", () => {
        const result = conditionalProperty(true, undefined);

        assert.strictEqual(result, undefined);
      });
    });
  });

  describe("extractDefinedProperties", () => {
    describe("Basic Functionality", () => {
      it("should extract only allowed defined keys", () => {
        const source = {
          name: "John",
          age: 30,
          email: "john@example.com",
          password: "secret",
        };

        const result = extractDefinedProperties(source, ["name", "email"]);

        assert.strictEqual(result.name, "John");
        assert.strictEqual(result.email, "john@example.com");
        assert.ok(!("age" in result));
        assert.ok(!("password" in result));
      });

      it("should skip undefined values", () => {
        const source = {
          name: "John",
          age: undefined,
          email: "john@example.com",
        };

        const result = extractDefinedProperties(source, ["name", "age", "email"]);

        assert.strictEqual(result.name, "John");
        assert.strictEqual(result.email, "john@example.com");
        assert.ok(!("age" in result));
      });

      it("should handle empty allowed keys", () => {
        const source = {
          name: "John",
          age: 30,
        };

        const result = extractDefinedProperties(source, []);

        assert.strictEqual(Object.keys(result).length, 0);
      });

      it("should handle non-existent keys", () => {
        const source = {
          name: "John",
        };

        const result = extractDefinedProperties(source, ["name", "age" as any]);

        assert.strictEqual(result.name, "John");
        assert.ok(!("age" in result));
      });
    });

    describe("Value Preservation", () => {
      it("should preserve null values", () => {
        const source = {
          name: "John",
          age: null,
        };

        const result = extractDefinedProperties(source, ["name", "age"]);

        assert.strictEqual(result.name, "John");
        assert.strictEqual(result.age, null);
        assert.ok("age" in result);
      });

      it("should preserve zero and false", () => {
        const source = {
          count: 0,
          enabled: false,
          name: "Test",
        };

        const result = extractDefinedProperties(source, ["count", "enabled", "name"]);

        assert.strictEqual(result.count, 0);
        assert.strictEqual(result.enabled, false);
        assert.strictEqual(result.name, "Test");
      });

      it("should preserve empty string", () => {
        const source = {
          name: "",
          description: undefined,
        };

        const result = extractDefinedProperties(source, ["name", "description"]);

        assert.strictEqual(result.name, "");
        assert.ok("name" in result);
        assert.ok(!("description" in result));
      });
    });

    describe("Complex Values", () => {
      it("should handle all allowed keys undefined", () => {
        const source = {
          name: undefined,
          age: undefined,
          email: undefined,
        };

        const result = extractDefinedProperties(source, ["name", "age", "email"]);

        assert.strictEqual(Object.keys(result).length, 0);
      });

      it("should handle objects and arrays", () => {
        const source = {
          user: { id: 1, name: "John" },
          tags: ["a", "b", "c"],
          metadata: undefined,
        };

        const result = extractDefinedProperties(source, ["user", "tags", "metadata"]);

        assert.ok(result.user !== undefined);
        assert.strictEqual((result.user as any).id, 1);
        assert.ok(Array.isArray(result.tags));
        assert.strictEqual(result.tags?.length, 3);
        assert.ok(!("metadata" in result));
      });
    });
  });

  describe("Integration Tests", () => {
    it("should combine removeUndefinedProperties with spread", () => {
      const updates = {
        name: "Updated Name",
        age: undefined,
        email: "new@example.com",
      };

      const cleaned = removeUndefinedProperties(updates);
      const result = { id: 1, ...cleaned };

      assert.strictEqual(result.id, 1);
      assert.strictEqual(result.name, "Updated Name");
      assert.strictEqual(result.email, "new@example.com");
      assert.ok(!("age" in result));
    });

    it("should use conditionalProperty in object construction", () => {
      const includeExtra = true;
      const obj = {
        id: 1,
        name: "Test",
        ...conditionalProperty(includeExtra, { extra: "data" }),
      };

      assert.strictEqual(obj.id, 1);
      assert.strictEqual((obj as any).extra, "data");
    });
  });

  describe("Performance and Edge Cases", () => {
    it("should handle large object with mixed values", () => {
      const source: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        source[`key${i}`] = i % 2 === 0 ? i : undefined;
      }

      const result = removeUndefinedProperties(source);

      assert.strictEqual(Object.keys(result).length, 50);
      assert.strictEqual(result.key0, 0);
      assert.ok(!("key1" in result));
    });
  });
});
