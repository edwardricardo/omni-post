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

import { describe, it, expect } from "vitest";
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

        expect(result.name).toBe("John");
        expect(result.email).toBe("john@example.com");
        expect("age" in result).toBeFalsy();
        expect("phone" in result).toBeFalsy();
      });

      it("should keep null values", () => {
        const obj = {
          name: "John",
          age: null,
          email: "john@example.com",
        };

        const result = removeUndefinedProperties(obj);

        expect(result.age).toBe(null);
        expect("age" in result).toBeTruthy();
      });

      it("should keep zero values", () => {
        const obj = {
          count: 0,
          value: undefined,
          enabled: false,
        };

        const result = removeUndefinedProperties(obj);

        expect(result.count).toBe(0);
        expect(result.enabled).toBe(false);
        expect("value" in result).toBeFalsy();
      });

      it("should handle empty object", () => {
        const obj = {};

        const result = removeUndefinedProperties(obj);

        expect(Object.keys(result).length).toBe(0);
      });

      it("should handle all undefined properties", () => {
        const obj = {
          a: undefined,
          b: undefined,
          c: undefined,
        };

        const result = removeUndefinedProperties(obj);

        expect(Object.keys(result).length).toBe(0);
      });

      it("should handle no undefined properties", () => {
        const obj = {
          name: "Alice",
          age: 30,
          active: true,
        };

        const result = removeUndefinedProperties(obj);

        expect(Object.keys(result).length).toBe(3);
        expect(result.name).toBe("Alice");
        expect(result.age).toBe(30);
        expect(result.active).toBe(true);
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty string", () => {
        const obj = {
          name: "",
          age: undefined,
        };

        const result = removeUndefinedProperties(obj);

        expect(result.name).toBe("");
        expect("name" in result).toBeTruthy();
        expect("age" in result).toBeFalsy();
      });

      it("should handle nested objects", () => {
        const obj = {
          user: { name: "John", age: undefined },
          settings: undefined,
        };

        const result = removeUndefinedProperties(obj);

        expect(result.user !== undefined).toBeTruthy();
        expect("settings" in result).toBeFalsy();
      });

      it("should handle arrays", () => {
        const obj = {
          items: [1, 2, 3],
          tags: undefined,
        };

        const result = removeUndefinedProperties(obj);

        expect(Array.isArray(result.items)).toBeTruthy();
        expect(result.items?.length).toBe(3);
        expect("tags" in result).toBeFalsy();
      });
    });
  });

  describe("conditionalProperty", () => {
    describe("Basic Functionality", () => {
      it("should return value when condition is true", () => {
        const result = conditionalProperty(true, { key: "value" });

        expect(typeof result).toBe("object");
        expect((result as any).key).toBe("value");
      });

      it("should return empty object when condition is false", () => {
        const result = conditionalProperty(false, { key: "value" });

        expect(typeof result).toBe("object");
        expect(Object.keys(result).length).toBe(0);
      });
    });

    describe("Spread Operator Integration", () => {
      it("should work with spread operator (true case)", () => {
        const base = { id: 1, name: "Test" };
        const optional = conditionalProperty(true, { extra: "data" });

        const merged = { ...base, ...optional };

        expect(merged.id).toBe(1);
        expect((merged as any).extra).toBe("data");
      });

      it("should work with spread operator (false case)", () => {
        const base = { id: 1, name: "Test" };
        const optional = conditionalProperty(false, { extra: "data" });

        const merged = { ...base, ...optional };

        expect(merged.id).toBe(1);
        expect("extra" in merged).toBeFalsy();
        expect(Object.keys(merged).length).toBe(2);
      });
    });

    describe("Different Value Types", () => {
      it("should handle string values", () => {
        const result = conditionalProperty(true, "test-value");

        expect(result).toBe("test-value");
      });

      it("should handle number values", () => {
        const result = conditionalProperty(true, 42);

        expect(result).toBe(42);
      });

      it("should handle null", () => {
        const result = conditionalProperty(true, null);

        expect(result).toBe(null);
      });

      it("should handle undefined", () => {
        const result = conditionalProperty(true, undefined);

        expect(result).toBe(undefined);
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

        expect(result.name).toBe("John");
        expect(result.email).toBe("john@example.com");
        expect("age" in result).toBeFalsy();
        expect("password" in result).toBeFalsy();
      });

      it("should skip undefined values", () => {
        const source = {
          name: "John",
          age: undefined,
          email: "john@example.com",
        };

        const result = extractDefinedProperties(source, ["name", "age", "email"]);

        expect(result.name).toBe("John");
        expect(result.email).toBe("john@example.com");
        expect("age" in result).toBeFalsy();
      });

      it("should handle empty allowed keys", () => {
        const source = {
          name: "John",
          age: 30,
        };

        const result = extractDefinedProperties(source, []);

        expect(Object.keys(result).length).toBe(0);
      });

      it("should handle non-existent keys", () => {
        const source = {
          name: "John",
        };

        const result = extractDefinedProperties(source, ["name", "age" as any]);

        expect(result.name).toBe("John");
        expect("age" in result).toBeFalsy();
      });
    });

    describe("Value Preservation", () => {
      it("should preserve null values", () => {
        const source = {
          name: "John",
          age: null,
        };

        const result = extractDefinedProperties(source, ["name", "age"]);

        expect(result.name).toBe("John");
        expect(result.age).toBe(null);
        expect("age" in result).toBeTruthy();
      });

      it("should preserve zero and false", () => {
        const source = {
          count: 0,
          enabled: false,
          name: "Test",
        };

        const result = extractDefinedProperties(source, ["count", "enabled", "name"]);

        expect(result.count).toBe(0);
        expect(result.enabled).toBe(false);
        expect(result.name).toBe("Test");
      });

      it("should preserve empty string", () => {
        const source = {
          name: "",
          description: undefined,
        };

        const result = extractDefinedProperties(source, ["name", "description"]);

        expect(result.name).toBe("");
        expect("name" in result).toBeTruthy();
        expect("description" in result).toBeFalsy();
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

        expect(Object.keys(result).length).toBe(0);
      });

      it("should handle objects and arrays", () => {
        const source = {
          user: { id: 1, name: "John" },
          tags: ["a", "b", "c"],
          metadata: undefined,
        };

        const result = extractDefinedProperties(source, ["user", "tags", "metadata"]);

        expect(result.user !== undefined).toBeTruthy();
        expect((result.user as any).id).toBe(1);
        expect(Array.isArray(result.tags)).toBeTruthy();
        expect(result.tags?.length).toBe(3);
        expect("metadata" in result).toBeFalsy();
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

      expect(result.id).toBe(1);
      expect(result.name).toBe("Updated Name");
      expect(result.email).toBe("new@example.com");
      expect("age" in result).toBeFalsy();
    });

    it("should use conditionalProperty in object construction", () => {
      const includeExtra = true;
      const obj = {
        id: 1,
        name: "Test",
        ...conditionalProperty(includeExtra, { extra: "data" }),
      };

      expect(obj.id).toBe(1);
      expect((obj as any).extra).toBe("data");
    });
  });

  describe("Performance and Edge Cases", () => {
    it("should handle large object with mixed values", () => {
      const source: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        source[`key${i}`] = i % 2 === 0 ? i : undefined;
      }

      const result = removeUndefinedProperties(source);

      expect(Object.keys(result).length).toBe(50);
      expect(result.key0).toBe(0);
      expect("key1" in result).toBeFalsy();
    });
  });
});
