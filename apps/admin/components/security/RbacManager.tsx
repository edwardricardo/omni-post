"use client";

/**
 * @file RbacManager.tsx
 * @description Admin RBAC management panel for viewing roles, permissions, and users per role.
 *   Uses CSS design tokens and reusable UI components.
 * @layer presentation
 */

import { useState, useEffect, useCallback } from "react";
import { toast } from "@packages/ui";

import { api, type RoleInfo } from "../../lib/apiClient";
import { LoadingSpinner } from "../shared/LoadingSpinner";

import { InputDialog } from "../ui/InputDialog";
import { Badge } from "../ui/Badge";

interface RbacUser {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLogin: string | null;
  isActive: boolean;
}

const ROLE_VARIANT: Record<string, "info" | "success" | "neutral"> = {
  SUPER_ADMIN: "info",
  ADMIN: "info",
  SUPPORT: "success",
};

export default function RbacManager() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleUsers, setRoleUsers] = useState<RbacUser[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    newRole: string;
    userName: string;
    originalRole: string;
  } | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      const response = await api.security.rbac.getRoles();
      if (!response.ok) {
        throw new Error("Failed to fetch roles");
      }

      setRoles(response.roles);
      setPermissionCategories(response.permissionCategories);

      if (response.roles.length > 0 && !selectedRole && response.roles[0]) {
        setSelectedRole(response.roles[0].role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [selectedRole]);

  const fetchRoleUsers = useCallback(async (role: string) => {
    try {
      const response = await api.security.rbac.getUsersByRole(role);
      if (!response.ok) {
        throw new Error("Failed to fetch role users");
      }

      const rawUsers = (response.users || []) as Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        lastLogin: string | null;
        isActive: boolean;
      }>;
      const mapped: RbacUser[] = rawUsers.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLogin: user.lastLogin,
        isActive: user.isActive,
      }));

      setRoleUsers(mapped);
    } catch {
      // Failed to fetch role users -- list will remain empty
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    if (selectedRole) {
      fetchRoleUsers(selectedRole);
    }
  }, [selectedRole, fetchRoleUsers]);

  const handleRoleChange = useCallback(async (userId: string, newRole: string, reason: string) => {
    try {
      setActionLoading(userId);
      const response = await api.security.rbac.updateUserRole(userId, newRole, reason);
      if (!response.ok) {
        throw new Error("Failed to update user role");
      }
      setRoleUsers((prev) => prev.filter((user) => user.id !== userId));
      toast({ title: "Success", description: "User role updated successfully" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update user role",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex justify-center items-center h-32">
          <LoadingSpinner size="lg" label="Loading RBAC data..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-4"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">Error Loading RBAC Manager</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const selectedRoleInfo = roles.find((r) => r.role === selectedRole);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Role-Based Access Control
        </h2>
        <p className="text-[var(--text-secondary)] text-sm">Manage user roles and permissions</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roles Sidebar */}
        <div className="lg:col-span-1">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">System Roles</h3>
          <div className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.role}
                onClick={() => setSelectedRole(role.role)}
                className={[
                  "w-full text-left p-3 rounded-lg border-2 transition-colors",
                  selectedRole === role.role
                    ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                    : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
                ].join(" ")}
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant={ROLE_VARIANT[role.role] ?? "neutral"}>{role.role}</Badge>
                  <span className="text-sm text-[var(--text-secondary)]">
                    {role.userCount} users
                  </span>
                </div>
                <div className="text-sm text-[var(--text-secondary)]">{role.description}</div>
              </button>
            ))}
          </div>

          {/* Permission Categories */}
          <div className="mt-4">
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
              Permission Categories
            </h3>
            <div className="space-y-2">
              {Object.entries(permissionCategories).map(([category, perms]) => (
                <div key={category} className="p-2 bg-[var(--bg-elevated)] rounded-md text-sm">
                  <div className="font-medium text-[var(--text-primary)]">{category}</div>
                  <div className="text-[var(--text-secondary)]">{perms.length} permissions</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Role Details and Users */}
        <div className="lg:col-span-2">
          {selectedRoleInfo && (
            <>
              <div className="mb-4 p-4 bg-[var(--bg-elevated)] rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                    {selectedRoleInfo.role}
                  </h3>
                  <Badge variant={ROLE_VARIANT[selectedRoleInfo.role] ?? "neutral"}>
                    {selectedRoleInfo.userCount} users
                  </Badge>
                </div>
                <p className="text-[var(--text-secondary)] mb-3">{selectedRoleInfo.description}</p>

                <div>
                  <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Permissions ({selectedRoleInfo.permissions.length})
                  </h4>
                  <div className="grid grid-cols-2 gap-1">
                    {selectedRoleInfo.permissions.map((permission) => (
                      <div
                        key={permission}
                        className="text-xs bg-[var(--bg-surface)] px-2 py-1 rounded-md border border-[var(--border-subtle)] text-[var(--text-primary)]"
                      >
                        {permission.replace(/[_:]/g, " ").toLowerCase()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                  Users with {selectedRoleInfo.role} role
                </h3>
                {roleUsers.length === 0 ? (
                  <div className="text-center text-[var(--text-secondary)] py-8">
                    No users found with this role
                  </div>
                ) : (
                  <div className="space-y-3">
                    {roleUsers.map((user) => (
                      <div
                        key={user.id}
                        className="border border-[var(--border-subtle)] rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <div>
                                <h4 className="font-medium text-[var(--text-primary)]">
                                  {user.name}
                                </h4>
                                <p className="text-sm text-[var(--text-secondary)]">{user.email}</p>
                              </div>
                              <Badge variant={user.isActive ? "success" : "error"}>
                                {user.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="mt-2 text-sm text-[var(--text-secondary)]">
                              Last login:{" "}
                              {user.lastLogin
                                ? new Date(user.lastLogin).toLocaleDateString()
                                : "Never"}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <select
                              className="text-sm border border-[var(--border-default)] rounded-md px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)]"
                              defaultValue={user.role}
                              onChange={(e) => {
                                if (e.target.value !== user.role) {
                                  setPendingRoleChange({
                                    userId: user.id,
                                    newRole: e.target.value,
                                    userName: user.name,
                                    originalRole: user.role,
                                  });
                                  setRoleDialogOpen(true);
                                }
                              }}
                              disabled={actionLoading === user.id}
                              aria-label={`Change role for ${user.name}`}
                            >
                              {roles.map((role) => (
                                <option key={role.role} value={role.role}>
                                  {role.role}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <InputDialog
        open={roleDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRoleChange(null);
          }
          setRoleDialogOpen(open);
        }}
        title="Change Role"
        description={
          pendingRoleChange
            ? `Change ${pendingRoleChange.userName}'s role to ${pendingRoleChange.newRole}`
            : ""
        }
        inputLabel="Reason for change"
        inputPlaceholder="e.g., Promotion to admin role"
        onConfirm={async (reason) => {
          if (!pendingRoleChange || !reason.trim()) return;
          await handleRoleChange(pendingRoleChange.userId, pendingRoleChange.newRole, reason);
          setPendingRoleChange(null);
          setRoleDialogOpen(false);
        }}
      />
    </div>
  );
}
