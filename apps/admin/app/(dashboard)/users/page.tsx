/**
 * @file page.tsx
 * @description Admin users management page. Lists admin users with role badges,
 * status indicators, and action controls for inviting, activating, and deactivating users.
 * @layer admin-pages
 */
"use client";

import { useState, useMemo, useCallback } from "react";
import { Users, UserCheck, Shield, Headset, Copy, Check } from "lucide-react";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@packages/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import {
  useAdminUsers,
  useCreateAdminUser,
  useDeactivateAdminUser,
  useActivateAdminUser,
} from "@/hooks/api/useAdminUsers";
import type { AdminUser } from "@/hooks/api/useAdminUsers";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

const ROLE_BADGE_VARIANT: Record<string, "info" | "success" | "neutral"> = {
  SUPER_ADMIN: "info",
  ADMIN: "success",
  SUPPORT: "neutral",
};

function AdminUsersContent() {
  const { data: users, isLoading, error, refetch } = useAdminUsers();
  const createMutation = useCreateAdminUser();
  const deactivateMutation = useDeactivateAdminUser();
  const activateMutation = useActivateAdminUser();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", role: "ADMIN" });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null);

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

  const handleInviteSubmit = useCallback(() => {
    if (!inviteForm.email.trim() || !inviteForm.name.trim()) {
      toast({
        title: "Validation",
        description: "Email and name are required",
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
          toast({ title: "Success", description: "Admin user created" });
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  }, [inviteForm, createMutation]);

  const handleDeactivateConfirm = useCallback(() => {
    if (!deactivateTarget) return;
    deactivateMutation.mutate(deactivateTarget.id, {
      onSuccess: () => {
        toast({ title: "Success", description: `${deactivateTarget.name} deactivated` });
        setDeactivateTarget(null);
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  }, [deactivateTarget, deactivateMutation]);

  const handleActivate = useCallback(
    (user: AdminUser) => {
      activateMutation.mutate(user.id, {
        onSuccess: () => {
          toast({ title: "Success", description: `${user.name} activated` });
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      });
    },
    [activateMutation]
  );

  const handleCopyPassword = useCallback(async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopiedPassword(true);
      toast({ title: "Copied", description: "Password copied to clipboard" });
    } catch {
      toast({
        title: "Error",
        description: "Failed to copy — please select and copy manually",
        variant: "destructive",
      });
    }
  }, [tempPassword]);

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Admin Users" />
        <div className="flex justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-12">
          <LoadingSpinner size="lg" label="Loading admin users..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Admin Users" />
        <div
          className="rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-6"
          role="alert"
        >
          <h2 className="font-medium text-[var(--error)] mb-2">Error Loading Users</h2>
          <p className="text-sm text-[var(--error)] mb-4">{error.message}</p>
          <ActionButton variant="primary" onClick={() => refetch()}>
            Retry
          </ActionButton>
        </div>
      </div>
    );
  }

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (u: AdminUser) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{u.name}</div>
          <div className="text-xs text-[var(--text-tertiary)]">{u.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (u: AdminUser) => (
        <Badge variant={ROLE_BADGE_VARIANT[u.role] ?? "neutral"}>{u.role.replace(/_/g, " ")}</Badge>
      ),
    },
    {
      key: "lastLogin",
      header: "Last Login",
      render: (u: AdminUser) =>
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never",
    },
    {
      key: "status",
      header: "Status",
      render: (u: AdminUser) => (
        <Badge variant={u.isActive ? "success" : "error"}>
          {u.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (u: AdminUser) => (
        <div className="flex gap-1">
          {u.isActive ? (
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => setDeactivateTarget(u)}
              disabled={u.role === "SUPER_ADMIN"}
              aria-label={`Deactivate ${u.name}`}
            >
              Deactivate
            </ActionButton>
          ) : (
            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => handleActivate(u)}
              loading={activateMutation.isPending}
              aria-label={`Activate ${u.name}`}
            >
              Activate
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Admin Users"
        description="Manage admin dashboard user accounts and access"
        actions={
          <ActionButton variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
            Invite User
          </ActionButton>
        }
      />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={stats.total} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Active" value={stats.active} icon={<UserCheck className="h-4 w-4" />} />
        <StatCard label="Admins" value={stats.admins} icon={<Shield className="h-4 w-4" />} />
        <StatCard label="Support" value={stats.support} icon={<Headset className="h-4 w-4" />} />
      </div>

      {/* Users Table */}
      <DataTable<AdminUser>
        columns={columns}
        data={users ?? []}
        isLoading={isLoading}
        rowKey={(u) => u.id}
        emptyMessage="No admin users found"
      />

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite Admin User</DialogTitle>
            <DialogDescription>
              Create a new admin account with a temporary password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="invite-email"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Email
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
                Name
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
                Role
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
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              onClick={handleInviteSubmit}
            >
              Create User
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temporary Password Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>User Created</DialogTitle>
            <DialogDescription>
              Share this temporary password with the new user. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Temporary Password
            </label>
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
              Done
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
        title="Deactivate User"
        description={
          deactivateTarget
            ? `Are you sure you want to deactivate ${deactivateTarget.name}? They will lose access to the admin dashboard.`
            : ""
        }
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={handleDeactivateConfirm}
        loading={deactivateMutation.isPending}
      />
    </div>
  );
}

export default function AdminUsersPage() {
  return <AdminUsersContent />;
}
