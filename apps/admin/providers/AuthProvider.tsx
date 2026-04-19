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
      .then((res) => res.json())
      .then((json: { ok?: boolean; data?: { permissions?: string[] }; permissions?: string[] }) => {
        const perms = json.data?.permissions ?? json.permissions ?? [];
        setPermissions(perms);
      })
      .catch(() => {
        // If permissions fail to load, SUPER_ADMIN gets all, others get none
        if (isSuperAdmin) {
          setPermissions(["*"]);
        }
      })
      .finally(() => setPermissionsLoaded(true));
  }, [isSuperAdmin]);

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
