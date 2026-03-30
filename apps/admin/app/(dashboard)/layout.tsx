/**
 * Dashboard Layout
 *
 * Server Component that verifies the admin-session cookie before rendering
 * any dashboard page. Unauthenticated requests are redirected to /auth/login.
 *
 * Uses verifyAccessToken() to validate the JWT stored in the httpOnly cookie
 * and retrieves the AdminUserProfile for display in the header.
 *
 * Renders a two-column shell: <SidebarNav> (client component) on the left,
 * and the existing header + main content area on the right.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { SidebarNav } from "@/components/shared/SidebarNav";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { ProjectProvider } from "@/providers/ProjectProvider";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Fixed-width collapsible sidebar */}
      <SidebarNav />

      {/* Right column: header + page content */}
      <div className="flex flex-1 flex-col min-w-0">
        <header
          className="bg-white shadow-xs border-b border-gray-200 shrink-0"
          role="banner"
          aria-label="Page header"
        >
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-xl font-semibold text-gray-900">OmniPost Admin</h1>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {user.name}{" "}
                  <span className="text-xs text-gray-400 capitalize">({user.role})</span>
                </span>
                <LogoutButton className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500" />
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 sm:px-6 lg:px-8 py-8" role="main">
          <ProjectProvider>{children}</ProjectProvider>
        </main>
      </div>
    </div>
  );
}
