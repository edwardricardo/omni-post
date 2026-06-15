"use client";

/**
 * @file context.tsx
 * @description React context and provider for the API client, exposing a shared ApiClient instance and centralized error handling to all descendant components.
 * @component ApiProvider
 * @layer infrastructure
 */

import React, { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import { apiClient } from "./client";
import { ApiError } from "@packages/api-errors";

interface ApiContextType {
  client: typeof apiClient;
  handleError: (error: ApiError) => void;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

interface ApiProviderProps {
  children: ReactNode;
  onError?: (error: ApiError) => void;
}

export function ApiProvider({ children, onError }: ApiProviderProps) {
  const handleError = useCallback(
    (error: ApiError) => {
      // Status-specific handling is deferred to the custom onError callback.
      // Components consuming useApi().handleError should provide their own
      // toast/redirect logic based on error.status.
      onError?.(error);
    },
    [onError]
  );

  const value = useMemo(
    () => ({
      client: apiClient,
      handleError,
    }),
    [handleError]
  );

  return <ApiContext value={value}>{children}</ApiContext>;
}

export function useApi() {
  const context = useContext(ApiContext);
  if (context === undefined) {
    throw new Error("useApi must be used within an ApiProvider");
  }
  return context;
}

// Custom hook for easy error handling
export function useApiErrorHandler() {
  const { handleError } = useApi();
  return handleError;
}
