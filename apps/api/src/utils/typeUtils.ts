/**
 * @file typeUtils.ts
 * @description Utility functions for handling exactOptionalPropertyTypes in TypeScript strict
 *              mode including undefined removal, conditional spreading, and form data extraction.
 * @layer infrastructure
 */

/**
 * Removes properties with undefined values from an object to make it compatible
 * with exactOptionalPropertyTypes: true
 */
export function removeUndefinedProperties<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};

  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }

  return result;
}

/**
 * Type-safe conditional spread helper for optional properties
 */
export function conditionalProperty<T>(condition: boolean, value: T): T | {} {
  return condition ? value : {};
}

/**
 * Safely extract defined properties from parsed form data
 */
export function extractDefinedProperties<T extends Record<string, unknown>>(
  source: T,
  allowedKeys: (keyof T)[]
): Partial<T> {
  const result: Partial<T> = {};

  for (const key of allowedKeys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
}
