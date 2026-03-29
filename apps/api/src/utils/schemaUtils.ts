import { ZodSchema } from "zod";

/**
 * IMPORTANT: We've replaced zod-to-json-schema with fastify-type-provider-zod
 * This file now just exports helper functions for backwards compatibility
 * The actual validation is handled by the Fastify Zod type provider
 */

/**
 * Helper to create Fastify schema object from Zod schemas
 * When using fastify-type-provider-zod, we can pass Zod schemas directly
 */
export function createFastifySchema(schemas: {
  params?: ZodSchema;
  querystring?: ZodSchema;
  body?: ZodSchema;
  headers?: ZodSchema;
  response?: Record<number, ZodSchema>;
}) {
  // With fastify-type-provider-zod, we can return Zod schemas directly
  // The type provider will handle the conversion automatically
  return schemas;
}

/**
 * Legacy function for backwards compatibility
 * No longer needed with fastify-type-provider-zod
 */
export function toJsonSchema<T extends ZodSchema>(zodSchema: T): T {
  // This function is no longer needed, but kept for backwards compatibility
  // The Fastify Zod type provider handles all conversions automatically
  return zodSchema;
}
