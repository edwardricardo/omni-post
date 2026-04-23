/**
 * Schema Utilities Tests
 *
 * Tests Zod schema utilities for Fastify integration including:
 * - Zod schema passthrough (for fastify-type-provider-zod)
 * - Fastify schema creation
 * - Schema validation behavior
 *
 * @file schemaUtils.test.ts
 * @description Tests for Schema Utilities
 * @layer infrastructure
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toJsonSchema, createFastifySchema } from "../src/utils/schemaUtils.js";

describe("Schema Utilities", () => {
  describe("toJsonSchema (Zod passthrough for Fastify)", () => {
    it("should return the original Zod schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = toJsonSchema(schema);

      // toJsonSchema now returns the Zod schema directly
      // because fastify-type-provider-zod handles conversion automatically
      assert.strictEqual(result, schema, "Should return original Zod schema");
    });

    it("should preserve Zod schema for validation", () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
      });

      const result = toJsonSchema(schema);

      // Verify it's still a valid Zod schema (Zod 4 uses instanceof check)
      assert.strictEqual(result, schema, "Should return original Zod schema");
      assert.ok(result.parse, "Should have parse method");
      assert.ok(result.safeParse, "Should have safeParse method");
    });

    it("should allow validation with returned schema", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = toJsonSchema(schema);

      // Should be able to validate with the returned schema
      const validData = { required: "test" };
      const parsed = result.parse(validData);
      assert.strictEqual(parsed.required, "test", "Should validate successfully");
    });

    it("should preserve string schemas", () => {
      const schema = z.object({
        name: z.string(),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ name: "John" });
      assert.strictEqual(parsed.name, "John");
    });

    it("should preserve number schemas", () => {
      const schema = z.object({
        count: z.number(),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ count: 42 });
      assert.strictEqual(parsed.count, 42);
    });

    it("should preserve boolean schemas", () => {
      const schema = z.object({
        active: z.boolean(),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ active: true });
      assert.strictEqual(parsed.active, true);
    });

    it("should preserve enum schemas", () => {
      const schema = z.object({
        status: z.enum(["active", "inactive", "pending"]),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ status: "active" });
      assert.strictEqual(parsed.status, "active");
    });

    it("should preserve array schemas", () => {
      const schema = z.object({
        tags: z.array(z.string()),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ tags: ["a", "b"] });
      assert.deepStrictEqual(parsed.tags, ["a", "b"]);
    });

    it("should preserve nested object schemas", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ user: { name: "John", age: 30 } });
      assert.strictEqual(parsed.user.name, "John");
      assert.strictEqual(parsed.user.age, 30);
    });
  });

  describe("createFastifySchema", () => {
    it("should return Zod schemas directly for Fastify type provider", () => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const fastifySchema = createFastifySchema({
        params: paramsSchema,
      });

      // With fastify-type-provider-zod, we return Zod schemas directly
      assert.ok(fastifySchema.params, "Should have params section");
      assert.strictEqual(fastifySchema.params, paramsSchema, "Should be the Zod schema");
    });

    it("should handle body schema", () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const fastifySchema = createFastifySchema({
        body: bodySchema,
      });

      assert.ok(fastifySchema.body, "Should have body section");
      assert.strictEqual(fastifySchema.body, bodySchema, "Should be the Zod schema");
    });

    it("should handle querystring schema", () => {
      const querySchema = z.object({
        page: z.string().transform(Number).pipe(z.number()),
        limit: z.string().transform(Number).pipe(z.number()),
      });

      const fastifySchema = createFastifySchema({
        querystring: querySchema,
      });

      assert.ok(fastifySchema.querystring, "Should have querystring section");
      assert.strictEqual(fastifySchema.querystring, querySchema, "Should be the Zod schema");
    });

    it("should handle headers schema", () => {
      const headersSchema = z.object({
        authorization: z.string(),
      });

      const fastifySchema = createFastifySchema({
        headers: headersSchema,
      });

      assert.ok(fastifySchema.headers, "Should have headers section");
      assert.strictEqual(fastifySchema.headers, headersSchema, "Should be the Zod schema");
    });

    it("should handle response schema", () => {
      const responseSchema = z.object({
        success: z.boolean(),
        data: z.any(),
      });

      const fastifySchema = createFastifySchema({
        response: {
          200: responseSchema,
        },
      });

      assert.ok(fastifySchema.response, "Should have response section");
      assert.ok(fastifySchema.response[200], "Should have 200 response");
      assert.strictEqual(fastifySchema.response[200], responseSchema, "Should be the Zod schema");
    });

    it("should handle multiple schema sections", () => {
      const paramsSchema = z.object({ id: z.string() });
      const bodySchema = z.object({ name: z.string() });
      const responseSchema = z.object({ success: z.boolean() });

      const fastifySchema = createFastifySchema({
        params: paramsSchema,
        body: bodySchema,
        response: { 200: responseSchema },
      });

      assert.ok(fastifySchema.params, "Should have params");
      assert.ok(fastifySchema.body, "Should have body");
      assert.ok(fastifySchema.response, "Should have response");
      assert.strictEqual(fastifySchema.params, paramsSchema);
      assert.strictEqual(fastifySchema.body, bodySchema);
      assert.strictEqual(fastifySchema.response[200], responseSchema);
    });

    it("should allow empty schema creation", () => {
      const fastifySchema = createFastifySchema({});

      assert.ok(fastifySchema, "Should return a schema object");
      assert.strictEqual(Object.keys(fastifySchema).length, 0, "Should be empty");
    });
  });

  describe("Zod Validation Integration", () => {
    it("should validate valid data", () => {
      const schema = z.object({
        name: z.string().min(3),
        age: z.number().min(0).max(150),
        email: z.string().email(),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({
        name: "John",
        age: 30,
        email: "john@example.com",
      });

      assert.strictEqual(parsed.name, "John");
      assert.strictEqual(parsed.age, 30);
      assert.strictEqual(parsed.email, "john@example.com");
    });

    it("should reject invalid data", () => {
      const schema = z.object({
        name: z.string().min(3),
        age: z.number().min(0),
      });

      const result = toJsonSchema(schema);

      assert.throws(() => {
        result.parse({
          name: "Jo", // Too short
          age: 30,
        });
      }, "Should throw validation error for short name");
    });

    it("should handle optional fields", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = toJsonSchema(schema);

      // Valid without optional field
      const parsed1 = result.parse({ required: "test" });
      assert.strictEqual(parsed1.required, "test");
      assert.strictEqual(parsed1.optional, undefined);

      // Valid with optional field
      const parsed2 = result.parse({ required: "test", optional: "value" });
      assert.strictEqual(parsed2.optional, "value");
    });

    it("should handle default values", () => {
      const schema = z.object({
        name: z.string(),
        role: z.string().default("user"),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ name: "John" });

      assert.strictEqual(parsed.name, "John");
      assert.strictEqual(parsed.role, "user");
    });

    it("should handle transformations", () => {
      const schema = z.object({
        age: z.string().transform((val) => parseInt(val, 10)),
      });

      const result = toJsonSchema(schema);
      const parsed = result.parse({ age: "25" });

      assert.strictEqual(parsed.age, 25);
      assert.strictEqual(typeof parsed.age, "number");
    });

    it("should handle refinements", () => {
      const schema = z
        .object({
          password: z.string().min(8),
          confirmPassword: z.string(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: "Passwords must match",
        });

      const result = toJsonSchema(schema);

      // Valid - passwords match
      const parsed = result.parse({
        password: "password123",
        confirmPassword: "password123",
      });
      assert.strictEqual(parsed.password, "password123");

      // Invalid - passwords don't match
      assert.throws(() => {
        result.parse({
          password: "password123",
          confirmPassword: "different",
        });
      }, "Should throw validation error for mismatched passwords");
    });
  });
});
