"use client";

/**
 * @file QueryProvider.tsx
 * @description Provides a TanStack Query client to the admin dashboard tree. Built via the
 *              shared `@packages/query-client` factory so admin and client share defaults and
 *              global error handling (toast + logger) consistently.
 * @layer infrastructure
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "@packages/ui";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";
import { createAppQueryClient } from "@packages/query-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() =>
    createAppQueryClient({
      // ConsoleLoggerAdapter is used because this Provider sits at the React tree
      // root, above any LoggerProvider, and cannot consume `useLogger()`.
      logger: new ConsoleLoggerAdapter("admin.query-client"),
      onQueryError: (error) => {
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
