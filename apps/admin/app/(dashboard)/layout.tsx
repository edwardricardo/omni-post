/**
 * @file layout.tsx
 * @description Dashboard layout with token verification, sidebar navigation,
 *   and QueryProvider for TanStack Query. Redirects to login on expired tokens.
 * @layer infrastructure
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SidebarNav } from "@/components/shared/SidebarNav";
import { QueryProvider } from "@/providers/QueryProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { verifyAccessToken } from "@/lib/auth/backend-client";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/login");

  const user = await verifyAccessToken(token);
  if (!user) {
    // Try refresh via the proxy endpoint
    redirect("/api/auth/refresh");
  }

  return (
    <QueryProvider>
      <AuthProvider userName={user.name} userRole={user.role}>
        <div className="flex min-h-screen bg-[var(--bg-base)]">
          <SidebarNav userName={user.name} userRole={user.role} />

          <div className="flex flex-1 flex-col min-w-0">
            <main
              id="main-content"
              className="flex-1 max-w-7xl w-full mx-auto px-6 py-4"
              role="main"
            >
              {children}
            </main>
          </div>
        </div>
      </AuthProvider>
    </QueryProvider>
  );
}
