"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, ReactNode } from "react";
import { Toaster } from "@packages/ui";
import { AuthProvider } from "@/lib/auth/authContext";
import { ApiProvider } from "@/lib/api";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <AuthProvider>
          {children}
          <Toaster />
          <ReactQueryDevtools initialIsOpen={false} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
