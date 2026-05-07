"use client";

/**
 * @file providers.tsx
 * @description Client-side provider tree wrapping children with TanStack Query, Logger, Auth,
 *              Toast, and Api contexts for the dashboard app. The QueryClient is built via the
 *              shared `@packages/query-client` factory so admin + client share defaults and
 *              global error handling (toast + logger) consistently.
 * @component Providers
 * @layer infrastructure
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, ReactNode } from "react";
import { Toaster, toast } from "@packages/ui";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";
import { LoggerProvider } from "@observability/browser-logger";
import { createAppQueryClient } from "@packages/query-client";
import { AuthProvider } from "@/lib/auth/authContext";
import { ApiProvider } from "@/lib/api";

interface ProvidersProps {
  children: ReactNode;
}

/**
 * @component Providers
 * @description Top-level client provider tree. Builds a single QueryClient instance per
 * mount (via `useState` lazy init) so route navigations don't reset the cache.
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() =>
    createAppQueryClient({
      // ConsoleLoggerAdapter is used here because the QueryClient lives ABOVE the
      // LoggerProvider and cannot consume `useLogger()`. It still routes errors to
      // the same browser console / sink the rest of the app uses.
      logger: new ConsoleLoggerAdapter("client.query-client"),
      onQueryError: (error, query) => {
        // Per-query opt-out: graceful-degradation queries set
        // `meta: { suppressGlobalErrorToast: true }` to keep the failure
        // silent in the UI (canon entry tanstack-query-v5-migration-
        // patterns-from-raw-fetch — tkdodo `meta` field). The error is still
        // logged by createAppQueryClient's QueryCache handler and surfaces in
        // the consumer hook's `error` field.
        if (query.meta?.suppressGlobalErrorToast === true) return;
        toast({
          title: "Request failed",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      },
      onMutationError: (error) => {
        toast({
          title: "Action failed",
          description: error instanceof Error ? error.message : "Unexpected error",
          variant: "destructive",
        });
      },
    })
  );

  return (
    <LoggerProvider defaultContext={{ app: "client" }}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <AuthProvider>
            {children}
            <Toaster />
            <ReactQueryDevtools initialIsOpen={false} />
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>
    </LoggerProvider>
  );
}
