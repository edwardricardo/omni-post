/**
 * Utility functions for handling exact optional types in TypeScript strict mode
 */

/**
 * Removes properties with undefined values from an object to make it compatible
 * with exactOptionalPropertyTypes: true
 */
export function removeUndefinedProperties<T extends Record<string, any>>(obj: T): Partial<T> {
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
export function extractDefinedProperties<T extends Record<string, any>>(
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
