/**
 * @file RbacManager.tsx
 * @description Admin RBAC management panel for viewing roles, permissions, and users per role.
 *   Supports creating/deleting custom roles, editing descriptions, and managing permissions.
 * @layer infrastructure
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "@packages/ui";
import { useCurrentUser } from "@/providers/AuthProvider";

import { ApiError, getErrorMessage } from "@packages/api-errors";
import { api, type RoleInfo } from "../../lib/apiClient";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { InputDialog, ConfirmDialog } from "@packages/ui";
import { Badge } from "../ui/Badge";
import { ActionButton } from "../ui/ActionButton";
import { PermissionGrid } from "./PermissionGrid";
import { CreateRoleDialog } from "./CreateRoleDialog";

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

/**
 * @component RbacManager
 * @description Admin RBAC management panel for viewing roles, editing descriptions, managing
 *   permissions via PermissionGrid, creating/deleting custom roles, and assigning users to roles.
 */
export default function RbacManager() {
  const tr = useTranslations("security.rbac");
  const tc = useTranslations("common");
  const { hasPermission } = useCurrentUser();
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleUsers, setRoleUsers] = useState<RbacUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    newRole: string;
    userName: string;
    originalRole: string;
  } | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      const response = await api.security.rbac.getRoles();
      if (!response.ok) throw new ApiError(0, null, "Failed to fetch roles");
      setRoles(response.roles);
      if (response.roles.length > 0 && !selectedRole && response.roles[0]) {
        setSelectedRole(response.roles[0].role);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [selectedRole]);

  const fetchRoleUsers = useCallback(async (role: string) => {
    try {
      const response = await api.security.rbac.getUsersByRole(role);
      if (!response.ok) throw new ApiError(0, null, "Failed to fetch role users");
      const rawUsers = (response.users || []) as RbacUser[];
      setRoleUsers(
        rawUsers.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          lastLogin: u.lastLogin,
          isActive: u.isActive,
        }))
      );
    } catch {
      setRoleUsers([]);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);
  useEffect(() => {
    if (selectedRole) fetchRoleUsers(selectedRole);
  }, [selectedRole, fetchRoleUsers]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: string, reason: string) => {
      try {
        setActionLoading(userId);
        const response = await api.security.rbac.updateUserRole(userId, newRole, reason);
        if (!response.ok) throw new ApiError(0, null, "Failed to update user role");
        setRoleUsers((prev) => prev.filter((user) => user.id !== userId));
        toast({ title: "Success", description: "User role updated successfully" });
      } catch (err) {
        toast({
          title: tc("error"),
          description: getErrorMessage(err),
          variant: "destructive",
        });
      } finally {
        setActionLoading(null);
      }
    },
    [tc]
  );

  const handleToggleActive = useCallback(
    async (user: RbacUser) => {
      try {
        setActionLoading(user.id);
        const endpoint = user.isActive
          ? `/admin/users/${user.id}/deactivate`
          : `/admin/users/${user.id}/activate`;
        const res = await fetch(`/api/backend${endpoint}`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw ApiError.fromResponse(res.status, body);
        }
        setRoleUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u))
        );
        toast({
          title: "Success",
          description: `${user.name} ${user.isActive ? "deactivated" : "activated"}`,
        });
      } catch (err) {
        toast({
          title: tc("error"),
          description: getErrorMessage(err),
          variant: "destructive",
        });
      } finally {
        setActionLoading(null);
      }
    },
    [tc]
  );

  const handleDeleteRole = useCallback(async () => {
    const roleInfo = roles.find((r) => r.role === selectedRole);
    if (!roleInfo) return;
    try {
      const response = await api.security.rbac.deleteRole(roleInfo.id);
      if (!response.ok) throw new ApiError(0, null, "Failed to delete role");
      toast({ title: "Success", description: `Role ${roleInfo.role} deleted` });
      setSelectedRole(null);
      await fetchRoles();
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [roles, selectedRole, fetchRoles, tc]);

  const handleSaveDescription = useCallback(async () => {
    const roleInfo = roles.find((r) => r.role === selectedRole);
    if (!roleInfo || !descriptionDraft.trim()) return;
    try {
      const response = await api.security.rbac.updateRole(roleInfo.id, {
        description: descriptionDraft.trim(),
      });
      if (!response.ok) throw new ApiError(0, null, "Failed to update description");
      toast({ title: "Success", description: "Description updated" });
      setEditingDescription(false);
      await fetchRoles();
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [roles, selectedRole, descriptionDraft, fetchRoles, tc]);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex justify-center items-center h-32">
          <LoadingSpinner size="lg" label={tc("loading")} />
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
          <h3 className="text-[var(--error)] font-medium">{tr("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const selectedRoleInfo = roles.find((r) => r.role === selectedRole);
  const canDeleteSelected =
    selectedRoleInfo && !selectedRoleInfo.isSystem && selectedRoleInfo.userCount === 0;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{tr("managerTitle")}</h2>
        <p className="text-[var(--text-secondary)] text-xs">{tr("managerDescription")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roles Sidebar */}
        <div className="lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-[var(--text-secondary)]">Roles</h3>
            <ActionButton size="sm" variant="primary" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-3 w-3" /> Create Role
            </ActionButton>
          </div>
          <div className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.role}
                onClick={() => {
                  setSelectedRole(role.role);
                  setEditingDescription(false);
                }}
                className={[
                  "w-full text-left p-3 rounded-lg border-2 transition-colors",
                  selectedRole === role.role
                    ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                    : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
                ].join(" ")}
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant={ROLE_VARIANT[role.role] ?? "neutral"}>{role.role}</Badge>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {tr("userCount", { count: role.userCount })}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)]">{role.description}</div>
                {!role.isSystem && (
                  <span className="text-[11px] text-[var(--text-tertiary)] italic">Custom</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Role Details and Users */}
        <div className="lg:col-span-2">
          {selectedRoleInfo && (
            <>
              <div className="mb-4 p-3 bg-[var(--bg-elevated)] rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {selectedRoleInfo.role}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant={ROLE_VARIANT[selectedRoleInfo.role] ?? "neutral"}>
                      {tr("userCount", { count: selectedRoleInfo.userCount })}
                    </Badge>
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      Level {selectedRoleInfo.level}
                    </span>
                    {canDeleteSelected && (
                      <ActionButton
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </ActionButton>
                    )}
                  </div>
                </div>

                {/* Editable description */}
                {editingDescription && selectedRoleInfo.role !== "SUPER_ADMIN" ? (
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      className="flex-1 text-xs border border-[var(--border-default)] rounded-md px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      aria-label="Edit role description"
                    />
                    <button
                      onClick={handleSaveDescription}
                      className="text-[var(--success)] hover:opacity-80"
                      aria-label="Save description"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingDescription(false)}
                      className="text-[var(--error)] hover:opacity-80"
                      aria-label="Cancel editing"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mb-3">
                    <p className="text-xs text-[var(--text-secondary)]">
                      {selectedRoleInfo.description}
                    </p>
                    {selectedRoleInfo.role !== "SUPER_ADMIN" && (
                      <button
                        onClick={() => {
                          setDescriptionDraft(selectedRoleInfo.description);
                          setEditingDescription(true);
                        }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        aria-label="Edit description"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Permission Grid */}
                <PermissionGrid role={selectedRoleInfo} onPermissionsSaved={fetchRoles} />
              </div>

              {/* Users table */}
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-3">
                  {tr("usersWithRole", { role: selectedRoleInfo.role })}
                </h3>
                {roleUsers.length === 0 ? (
                  <div className="text-center text-[var(--text-secondary)] text-xs py-8">
                    {tr("noUsers")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {roleUsers.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] rounded-md"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="min-w-0">
                            <h4 className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {user.name}
                            </h4>
                            <p className="text-[11px] text-[var(--text-secondary)] truncate">
                              {user.email}
                            </p>
                          </div>
                          <Badge variant={user.isActive ? "success" : "error"} size="sm">
                            {user.isActive ? tc("active") : tc("inactive")}
                          </Badge>
                        </div>
                        {user.role === "SUPER_ADMIN" ? (
                          <span className="text-[10px] text-[var(--text-tertiary)] italic">
                            Protected
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            {hasPermission("user:manage_roles") && (
                              <select
                                className="text-xs border border-[var(--border-default)] rounded-md px-1.5 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)]"
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
                                {roles
                                  .filter((r) => r.role !== "SUPER_ADMIN")
                                  .map((role) => (
                                    <option key={role.role} value={role.role}>
                                      {role.role}
                                    </option>
                                  ))}
                              </select>
                            )}
                            <button
                              className="text-xs px-2 py-1 rounded-md border border-[var(--border-default)] hover:bg-[var(--bg-overlay)] text-[var(--text-secondary)] disabled:opacity-40"
                              disabled={actionLoading === user.id}
                              onClick={() => handleToggleActive(user)}
                              aria-label={
                                user.isActive ? `Deactivate ${user.name}` : `Activate ${user.name}`
                              }
                            >
                              {actionLoading === user.id
                                ? "..."
                                : user.isActive
                                  ? "Deactivate"
                                  : "Activate"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <InputDialog
        open={roleDialogOpen}
        onOpenChange={(open) => {
          if (!open) setPendingRoleChange(null);
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
      <CreateRoleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={fetchRoles}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Role"
        description={`Are you sure you want to delete the role "${selectedRoleInfo?.role}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteRole}
      />
    </div>
  );
}
