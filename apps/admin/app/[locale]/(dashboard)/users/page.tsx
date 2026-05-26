/**
 * @file page.tsx
 * @description Admin users management page. Lists admin users with role badges,
 * status indicators, and action controls for inviting, activating, and deactivating users.
 * @layer infrastructure
 */
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  UserCheck,
  Shield,
  Headset,
  Copy,
  Check,
  Pencil,
  KeyRound,
  UserX,
} from "lucide-react";
import { useCurrentUser } from "@/providers/AuthProvider";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@packages/ui";
import { isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { ConfirmDialog } from "@packages/ui";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import {
  useAdminUsers,
  useCreateAdminUser,
  useDeactivateAdminUser,
  useActivateAdminUser,
  useUpdateAdminUser,
} from "@/hooks/api/useAdminUsers";
import type { AdminUser } from "@/hooks/api/useAdminUsers";
import { api } from "@/lib/apiClient";
import { useAdminPasswordReset } from "@/hooks/api/useAdminPasswordReset";
import { ChangePasswordDialog } from "@/components/users/ChangePasswordDialog";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

const ROLE_BADGE_VARIANT: Record<string, "info" | "success" | "neutral"> = {
  SUPER_ADMIN: "info",
  ADMIN: "success",
  SUPPORT: "neutral",
};

function AdminUsersContent() {
  const tu = useTranslations("users");
  const tc = useTranslations("common");
  const { hasPermission, userId } = useCurrentUser();
  const { data: users, isLoading, error, refetch } = useAdminUsers();
  const createMutation = useCreateAdminUser();
  const deactivateMutation = useDeactivateAdminUser();
  const activateMutation = useActivateAdminUser();
  const updateMutation = useUpdateAdminUser();
  const resetPasswordMutation = useAdminPasswordReset();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", role: "ADMIN" });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<AdminUser | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    role: "",
    department: "",
    team: "",
  });
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);

  // Fetch available roles for the edit dialog
  useEffect(() => {
    api.security.rbac
      .getRoles()
      .then((res) => {
        if (res.ok) {
          setAvailableRoles(res.roles.map((r) => r.role));
        }
      })
      .catch(() => {
        /* roles will fall back to empty */
      });
  }, []);

  const handleOpenEdit = useCallback((user: AdminUser) => {
    setEditTarget(user);
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role,
      department: "",
      team: "",
    });
  }, []);

  const handleEditSubmit = useCallback(() => {
    if (!editTarget) return;
    const data: Record<string, string> = {};
    if (editForm.name.trim() && editForm.name !== editTarget.name) data.name = editForm.name.trim();
    if (editForm.email.trim() && editForm.email !== editTarget.email)
      data.email = editForm.email.trim();
    if (editForm.role && editForm.role !== editTarget.role) data.role = editForm.role;
    if (editForm.department.trim()) data.department = editForm.department.trim();
    if (editForm.team.trim()) data.team = editForm.team.trim();

    if (Object.keys(data).length === 0) {
      setEditTarget(null);
      return;
    }

    updateMutation.mutate(
      { id: editTarget.id, data },
      {
        onSuccess: () => {
          toast({ title: tu("success.updated", { name: editForm.name }) });
          setEditTarget(null);
        },
        onError: (err) => {
          toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
        },
      }
    );
  }, [editTarget, editForm, updateMutation, tu, tc]);

  // Stats
  const stats = useMemo(() => {
    if (!users) return { total: 0, active: 0, admins: 0, support: 0 };
    return {
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      admins: users.filter((u) => u.role === "SUPER_ADMIN" || u.role === "ADMIN").length,
      support: users.filter((u) => u.role === "SUPPORT").length,
    };
  }, [users]);

  const totalPages = Math.max(1, Math.ceil((users?.length ?? 0) / perPage));
  const paginatedUsers = useMemo(
    () => (users ?? []).slice((page - 1) * perPage, page * perPage),
    [users, page, perPage]
  );

  const handleInviteSubmit = useCallback(() => {
    if (!inviteForm.email.trim() || !inviteForm.name.trim()) {
      toast({
        title: tc("error"),
        description: tu("errors.validation"),
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(
      { email: inviteForm.email.trim(), name: inviteForm.name.trim(), role: inviteForm.role },
      {
        onSuccess: (data) => {
          setInviteOpen(false);
          setInviteForm({ email: "", name: "", role: "ADMIN" });
          setTempPassword(data.temporaryPassword);
          setSuccessDialogOpen(true);
          setCopiedPassword(false);
          toast({ title: tu("userCreated"), description: tu("success.created") });
        },
        onError: (err) => {
          toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
        },
      }
    );
  }, [inviteForm, createMutation, tc, tu]);

  const handleDeactivateConfirm = useCallback(() => {
    if (!deactivateTarget) return;
    deactivateMutation.mutate(deactivateTarget.id, {
      onSuccess: () => {
        toast({
          title: tu("deactivateTitle"),
          description: tu("success.deactivated", { name: deactivateTarget.name }),
        });
        setDeactivateTarget(null);
      },
      onError: (err) => {
        toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
      },
    });
  }, [deactivateTarget, deactivateMutation, tc, tu]);

  const handleActivate = useCallback(
    (user: AdminUser) => {
      activateMutation.mutate(user.id, {
        onSuccess: () => {
          toast({
            title: tu("activate"),
            description: tu("success.activated", { name: user.name }),
          });
        },
        onError: (err) => {
          toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
        },
      });
    },
    [activateMutation, tc, tu]
  );

  const handleCopyPassword = useCallback(async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopiedPassword(true);
      toast({ title: tu("success.copied"), description: tu("success.copied") });
    } catch {
      toast({
        title: tc("error"),
        description: tu("errors.copyFailed"),
        variant: "destructive",
      });
    }
  }, [tempPassword, tc, tu]);

  const handlePasswordAction = useCallback(
    (user: AdminUser) => {
      if (user.id === userId) {
        setChangePasswordOpen(true);
      } else {
        setResetPasswordTarget(user);
      }
    },
    [userId]
  );

  const handleResetPasswordConfirm = useCallback(() => {
    if (!resetPasswordTarget) return;
    resetPasswordMutation.mutate(resetPasswordTarget.id, {
      onSuccess: () => {
        toast({ title: tu("success.passwordResetSent", { name: resetPasswordTarget.name }) });
        setResetPasswordTarget(null);
      },
      onError: (err) => {
        toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
      },
    });
  }, [resetPasswordTarget, resetPasswordMutation, tu, tc]);

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title={tu("title")} />
        <div className="flex justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-12">
          <LoadingSpinner size="lg" label={tu("loadingUsers")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div className="p-6">
          <PageHeader title={tu("title")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div className="p-6">
        <PageHeader title={tu("title")} />
        <div
          className="rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-6"
          role="alert"
        >
          <h2 className="font-medium text-[var(--error)] mb-2">{tu("errorTitle")}</h2>
          <p className="text-sm text-[var(--error)] mb-4">{getErrorMessage(error)}</p>
          <ActionButton variant="primary" loading={isLoading} onClick={() => refetch()}>
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  const columns = [
    {
      key: "name",
      header: tu("table.name"),
      render: (u: AdminUser) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[var(--text-primary)]">{u.name}</span>
            {u.id === userId && <Badge variant="info">{tu("table.you")}</Badge>}
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">{u.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: tu("table.role"),
      render: (u: AdminUser) => (
        <Badge variant={ROLE_BADGE_VARIANT[u.role] ?? "neutral"}>{u.role.replace(/_/g, " ")}</Badge>
      ),
    },
    {
      key: "lastLogin",
      header: tu("table.lastLogin"),
      render: (u: AdminUser) =>
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : tc("never"),
    },
    {
      key: "status",
      header: tu("table.status"),
      render: (u: AdminUser) => (
        <Badge variant={u.isActive ? "success" : "error"}>
          {u.isActive ? tc("active") : tc("inactive")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: tu("table.actions"),
      render: (u: AdminUser) => (
        <div className="flex gap-1">
          {hasPermission("user:manage") && (
            <>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => handleOpenEdit(u)}
                disabled={u.role === "SUPER_ADMIN"}
                aria-label={`${tc("edit")} ${u.name}`}
              >
                <Pencil className="h-3 w-3" />
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => handlePasswordAction(u)}
                disabled={u.role === "SUPER_ADMIN" && u.id !== userId}
                aria-label={`${tu("passwordAction")} ${u.name}`}
              >
                <KeyRound className="h-3 w-3" />
              </ActionButton>
              {u.isActive ? (
                <ActionButton
                  variant="danger"
                  size="sm"
                  onClick={() => setDeactivateTarget(u)}
                  disabled={u.role === "SUPER_ADMIN"}
                  aria-label={`${tu("deactivate")} ${u.name}`}
                >
                  <UserX className="h-3 w-3" />
                </ActionButton>
              ) : (
                <ActionButton
                  variant="primary"
                  size="sm"
                  onClick={() => handleActivate(u)}
                  loading={activateMutation.isPending}
                  aria-label={`${tu("activate")} ${u.name}`}
                >
                  <UserCheck className="h-3 w-3" />
                </ActionButton>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title={tu("title")}
        description={tu("description")}
        actions={
          hasPermission("user:manage") ? (
            <ActionButton variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
              {tu("inviteUser")}
            </ActionButton>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={tu("stats.totalUsers")}
          value={stats.total}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label={tu("stats.active")}
          value={stats.active}
          icon={<UserCheck className="h-4 w-4" />}
        />
        <StatCard
          label={tu("stats.admins")}
          value={stats.admins}
          icon={<Shield className="h-4 w-4" />}
        />
        <StatCard
          label={tu("stats.support")}
          value={stats.support}
          icon={<Headset className="h-4 w-4" />}
        />
      </div>

      {/* Users Table */}
      <DataTable<AdminUser>
        columns={columns}
        data={paginatedUsers}
        isLoading={isLoading}
        rowKey={(u) => u.id}
        emptyMessage={tc("noData")}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={users?.length ?? 0}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
      />

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tu("inviteTitle")}</DialogTitle>
            <DialogDescription>{tu("inviteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="invite-email"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("email")}
              </label>
              <input
                id="invite-email"
                type="email"
                className={INPUT_CLASS}
                value={inviteForm.email}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                aria-required="true"
              />
            </div>
            <div>
              <label
                htmlFor="invite-name"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("name")}
              </label>
              <input
                id="invite-name"
                type="text"
                className={INPUT_CLASS}
                value={inviteForm.name}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, name: e.target.value }))}
                aria-required="true"
              />
            </div>
            <div>
              <label
                htmlFor="invite-role"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("role")}
              </label>
              <select
                id="invite-role"
                className={INPUT_CLASS}
                value={inviteForm.role}
                onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}
              >
                <option value="ADMIN">Admin</option>
                <option value="SUPPORT">Support</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="secondary" size="sm" onClick={() => setInviteOpen(false)}>
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              onClick={handleInviteSubmit}
            >
              {tu("createUser")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temporary Password Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tu("userCreated")}</DialogTitle>
            <DialogDescription>{tu("tempPasswordDesc")}</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              {tu("tempPassword")}
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] select-all">
                {tempPassword}
              </code>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={handleCopyPassword}
                aria-label="Copy password"
              >
                {copiedPassword ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </ActionButton>
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="primary" size="sm" onClick={() => setSuccessDialogOpen(false)}>
              {tu("done")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tu("editTitle")}</DialogTitle>
            <DialogDescription>{tu("editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="edit-name"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("name")}
              </label>
              <input
                id="edit-name"
                type="text"
                className={INPUT_CLASS}
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <label
                htmlFor="edit-email"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("email")}
              </label>
              <input
                id="edit-email"
                type="email"
                className={INPUT_CLASS}
                value={editForm.email}
                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div>
              <label
                htmlFor="edit-role"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("role")}
              </label>
              <select
                id="edit-role"
                className={INPUT_CLASS}
                value={editForm.role}
                onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
              >
                {availableRoles
                  .filter((r) => r !== "SUPER_ADMIN")
                  .map((role) => (
                    <option key={role} value={role}>
                      {role.replace(/_/g, " ")}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="edit-department"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("department")}
              </label>
              <input
                id="edit-department"
                type="text"
                className={INPUT_CLASS}
                value={editForm.department}
                onChange={(e) => setEditForm((prev) => ({ ...prev, department: e.target.value }))}
                placeholder="e.g., Engineering"
              />
            </div>
            <div>
              <label
                htmlFor="edit-team"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tu("team")}
              </label>
              <input
                id="edit-team"
                type="text"
                className={INPUT_CLASS}
                value={editForm.team}
                onChange={(e) => setEditForm((prev) => ({ ...prev, team: e.target.value }))}
                placeholder="e.g., Platform"
              />
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="secondary" size="sm" onClick={() => setEditTarget(null)}>
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={updateMutation.isPending}
              onClick={handleEditSubmit}
            >
              {tc("save")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirm */}
      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null);
        }}
        title={tu("deactivateTitle")}
        description={deactivateTarget ? tu("deactivateDesc", { name: deactivateTarget.name }) : ""}
        confirmLabel={tu("deactivate")}
        variant="danger"
        onConfirm={handleDeactivateConfirm}
        loading={deactivateMutation.isPending}
      />

      {/* Change Own Password Dialog */}
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />

      {/* Reset Another User's Password Confirm */}
      <ConfirmDialog
        open={resetPasswordTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetPasswordTarget(null);
        }}
        title={tu("resetPasswordTitle")}
        description={
          resetPasswordTarget
            ? tu("resetPasswordDesc", {
                name: resetPasswordTarget.name,
                email: resetPasswordTarget.email,
              })
            : ""
        }
        confirmLabel={tu("sendResetEmail")}
        onConfirm={handleResetPasswordConfirm}
        loading={resetPasswordMutation.isPending}
      />
    </div>
  );
}

/**
 * @component AdminUsersPage
 * @description Manages admin users with role badges, status indicators, and actions for inviting, activating, and deactivating users.
 */
export default function AdminUsersPage() {
  return <AdminUsersContent />;
}
