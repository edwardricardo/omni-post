"use client";

/**
 * @file context.tsx
 * @description React context and provider for the API client, exposing a shared ApiClient instance and centralized error handling to all descendant components.
 */

import React, { createContext, useContext, ReactNode } from "react";
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
  const handleError = (error: ApiError) => {
    // Call custom error handler if provided
    onError?.(error);

    // Status-specific handling is deferred to the custom onError callback.
    // Components consuming useApi().handleError should provide their own
    // toast/redirect logic based on error.status.
  };

  const value = {
    client: apiClient,
    handleError,
  };

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
