/**
 * @file page.tsx
 * @description Admin users management page. Lists admin users with role badges,
 * status indicators, and action controls for inviting, activating, and deactivating users.
 * @layer admin-pages
 */
"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Users, UserCheck, Shield, Headset, Copy, Check } from "lucide-react";
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
  const tu = useTranslations("users");
  const tc = useTranslations("common");
  const { hasPermission } = useCurrentUser();
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
          toast({ title: tc("error"), description: err.message, variant: "destructive" });
        },
      }
    );
  }, [inviteForm, createMutation]);

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
        toast({ title: tc("error"), description: err.message, variant: "destructive" });
      },
    });
  }, [deactivateTarget, deactivateMutation]);

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
          toast({ title: tc("error"), description: err.message, variant: "destructive" });
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
      toast({ title: tu("success.copied"), description: tu("success.copied") });
    } catch {
      toast({
        title: tc("error"),
        description: tu("errors.copyFailed"),
        variant: "destructive",
      });
    }
  }, [tempPassword]);

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
    return (
      <div className="p-6">
        <PageHeader title={tu("title")} />
        <div
          className="rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-6"
          role="alert"
        >
          <h2 className="font-medium text-[var(--error)] mb-2">{tu("errorTitle")}</h2>
          <p className="text-sm text-[var(--error)] mb-4">{error.message}</p>
          <ActionButton variant="primary" onClick={() => refetch()}>
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
          <div className="font-medium text-[var(--text-primary)]">{u.name}</div>
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
          {hasPermission("user:update") && (
            <>
              {u.isActive ? (
                <ActionButton
                  variant="danger"
                  size="sm"
                  onClick={() => setDeactivateTarget(u)}
                  disabled={u.role === "SUPER_ADMIN"}
                  aria-label={`${tu("deactivate")} ${u.name}`}
                >
                  {tu("deactivate")}
                </ActionButton>
              ) : (
                <ActionButton
                  variant="primary"
                  size="sm"
                  onClick={() => handleActivate(u)}
                  loading={activateMutation.isPending}
                  aria-label={`${tu("activate")} ${u.name}`}
                >
                  {tu("activate")}
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
          hasPermission("user:create") ? (
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
        data={users ?? []}
        isLoading={isLoading}
        rowKey={(u) => u.id}
        emptyMessage={tc("noData")}
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
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              {tu("tempPassword")}
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
              {tu("done")}
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
    </div>
  );
}

export default function AdminUsersPage() {
  return <AdminUsersContent />;
}
