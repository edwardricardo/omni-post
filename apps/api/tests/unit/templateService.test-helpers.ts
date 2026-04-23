/**
 * @file templateService.test-helpers.ts
 * @description Test helpers for template service test helpers
 * @layer infrastructure
 */
import { vi } from "vitest";

export type MockedMethod = ReturnType<typeof vi.fn>;

export function mockPrismaMethod(model: any, methodName: string): MockedMethod {
  const mockFn = vi.fn();
  const original = model[methodName];
  model[methodName] = mockFn;
  (mockFn as any)._original = original;
  (mockFn as any)._model = model;
  (mockFn as any)._methodName = methodName;
  return mockFn;
}

export function restoreMock(mockFn: any): void {
  if (mockFn._original && mockFn._model && mockFn._methodName) {
    mockFn._model[mockFn._methodName] = mockFn._original;
  }
}
