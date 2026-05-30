/**
 * @file AuthProvider.tsx
 * @description Client context that exposes the current admin user's name, role,
 * and permissions to all dashboard pages. Permissions are fetched from the API
 * on mount and cached. Provides hasPermission() for granular access control.
 * @layer infrastructure
 */
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

const log = new ConsoleLoggerAdapter("admin.auth-provider");

interface AuthContextValue {
  userId: string;
  userName: string;
  userRole: string;
  isSuperAdmin: boolean;
  permissions: string[];
  permissionsLoaded: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  userId: "",
  userName: "",
  userRole: "",
  isSuperAdmin: false,
  permissions: [],
  permissionsLoaded: false,
  hasPermission: () => false,
  hasAnyPermission: () => false,
});

export function AuthProvider({
  userId,
  userName,
  userRole,
  children,
}: {
  userId: string;
  userName: string;
  userRole: string;
  children: ReactNode;
}) {
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/backend/auth/permissions", { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`permissions fetch failed: ${res.status}`);
        }
        return res.json() as Promise<{
          ok?: boolean;
          data?: { permissions?: string[] };
          permissions?: string[];
        }>;
      })
      .then((json) => {
        const perms = json.data?.permissions ?? json.permissions ?? [];
        setPermissions(perms);
      })
      .catch((err) => {
        // Failure-closed: any error (network, non-2xx, malformed body) yields zero
        // permissions. The user must refresh the session to retry.
        log.error("Failed to load permissions; falling back to no access", err, {
          userId,
          userRole,
        });
        setPermissions([]);
      })
      .finally(() => setPermissionsLoaded(true));
  }, [userId, userRole]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (isSuperAdmin) return true;
      return permissions.includes(permission);
    },
    [isSuperAdmin, permissions]
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]) => {
      if (isSuperAdmin) return true;
      return perms.some((p) => permissions.includes(p));
    },
    [isSuperAdmin, permissions]
  );

  const value = useMemo(
    () => ({
      userId,
      userName,
      userRole,
      isSuperAdmin,
      permissions,
      permissionsLoaded,
      hasPermission,
      hasAnyPermission,
    }),
    [
      userId,
      userName,
      userRole,
      isSuperAdmin,
      permissions,
      permissionsLoaded,
      hasPermission,
      hasAnyPermission,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser() {
  return useContext(AuthContext);
}
