/**
 * @file useProviders.integration.test.ts
 * @description Integration tests for useProviders hook — provider fetching, config access.
 * @layer integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProviders } from "../../lib/hooks/useProviders";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.providers).toEqual([]);
  });

  it("returns providers after successful fetch", async () => {
    const mockProviders = [
      {
        id: "x",
        name: "X",
        type: "social",
        enabled: true,
        config: {},
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "instagram",
        name: "Instagram",
        type: "social",
        enabled: true,
        config: {},
        createdAt: "",
        updatedAt: "",
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProviders,
    });

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.providers).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("returns error state when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).not.toBeNull();
  });

  it("returns enabledProviders filtered from providers", async () => {
    const mockProviders = [
      {
        id: "x",
        name: "X",
        type: "social",
        enabled: true,
        config: {},
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "disabled",
        name: "Disabled",
        type: "social",
        enabled: false,
        config: {},
        createdAt: "",
        updatedAt: "",
      },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockProviders });

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.enabledProviders).toHaveLength(1);
    expect(result.current.enabledProviders[0]?.id).toBe("x");
  });

  it("exposes providerConfigs from registry", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(Array.isArray(result.current.providerConfigs)).toBe(true);
    expect(result.current.providerConfigs.length).toBeGreaterThan(0);
  });

  it("exposes getProviderConfig function", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(typeof result.current.getProviderConfig).toBe("function");
  });

  it("exposes validateContent function", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(typeof result.current.validateContent).toBe("function");
  });

  it("exposes supportsFeature function", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(typeof result.current.supportsFeature).toBe("function");
  });

  it("exposes getOptimalTimes function", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    expect(typeof result.current.getOptimalTimes).toBe("function");
  });

  it("validates content correctly for a provider", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const { result } = renderHook(() => useProviders(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const validation = result.current.validateContent("x", "Hello!", []);
    expect(typeof validation.valid).toBe("boolean");
    expect(Array.isArray(validation.errors)).toBe(true);
  });
});
