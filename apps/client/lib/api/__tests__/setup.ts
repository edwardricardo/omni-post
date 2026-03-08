import { beforeEach, vi } from "vitest";
import "@testing-library/jest-dom";
import React from "react";

// Mock localStorage with actual storage
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value.toString();
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

const localStorageMock = new LocalStorageMock();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock File constructor for upload tests
global.File = class File {
  name: string;
  type: string;
  size: number;

  constructor(chunks: any[], name: string, options: any = {}) {
    this.name = name;
    this.type = options.type || "";
    this.size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  }
} as any;

// Mock FormData
global.FormData = class FormData {
  private data: Map<string, any> = new Map();

  append(key: string, value: any) {
    this.data.set(key, value);
  }

  get(key: string) {
    return this.data.get(key);
  }

  has(key: string) {
    return this.data.has(key);
  }
} as any;

// Make React globally available
global.React = React;

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});
