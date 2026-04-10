"use client";

/**
 * @file MfaManager.tsx
 * @description Admin MFA management panel for viewing user MFA status and performing
 *   administrative actions. Uses CSS design tokens and reusable UI components.
 * @layer presentation
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";
import { useCurrentUser } from "@/providers/AuthProvider";

import { api } from "../../lib/apiClient";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { ActionButton } from "../ui/ActionButton";
import { InputDialog } from "../ui/InputDialog";
import { Badge } from "../ui/Badge";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  mfaEnabled: boolean;
  backupCodesCount: number;
}

const ROLE_VARIANT: Record<string, "info" | "success" | "neutral"> = {
  SUPER_ADMIN: "info",
  ADMIN: "info",
};

export default function MfaManager() {
  const tm = useTranslations("security.mfa");
  const tc = useTranslations("common");
  const { hasPermission } = useCurrentUser();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [disableMfaDialogOpen, setDisableMfaDialogOpen] = useState(false);
  const [disableMfaTarget, setDisableMfaTarget] = useState<{ id: string; name: string } | null>(
    null
  );

  const fetchUsers = useCallback(async () => {
    try {
      const response = await api.admin.getAccounts({ limit: 100 });
      if (!response.ok) {
        throw new Error("Failed to load accounts");
      }

      const usersWithMfa: User[] = await Promise.all(
        response.accounts.map(async (account) => {
          let backupCodesCount = 0;
          if (account.mfaEnabled) {
            try {
              const mfaResponse = await api.security.mfa.getUserStatus(account.id);
              if (mfaResponse.ok) {
                backupCodesCount = mfaResponse.mfa.backupCodesCount;
              }
            } catch {
              // MFA status fetch failed -- use default count
            }
          }
          return {
            id: account.id,
            email: account.email,
            name: account.name,
            role: account.role,
            mfaEnabled: account.mfaEnabled,
            backupCodesCount,
          };
        })
      );

      setUsers(usersWithMfa);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleForceDisableMfa = useCallback(async (userId: string, reason: string) => {
    try {
      setActionLoading(userId);
      const response = await api.security.mfa.forceDisable(userId, reason);
      if (!response.ok) {
        throw new Error("Failed to disable MFA");
      }
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, mfaEnabled: false, backupCodesCount: 0 } : user
        )
      );
      toast({ title: "Success", description: "MFA disabled successfully" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to disable MFA",
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
          <h3 className="text-[var(--error)] font-medium">{tm("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{tm("managerTitle")}</h2>
        <p className="text-[var(--text-secondary)] text-sm">{tm("managerDescription")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-[var(--bg-elevated)] p-4 rounded-lg">
          <div className="text-sm text-[var(--text-secondary)]">{tm("totalUsers")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">{users.length}</div>
        </div>
        <div className="bg-[var(--success-subtle)] p-4 rounded-lg">
          <div className="text-sm text-[var(--success)]">{tm("mfaEnabled")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {users.filter((u) => u.mfaEnabled).length}
          </div>
        </div>
        <div className="bg-[var(--error-subtle)] p-4 rounded-lg">
          <div className="text-sm text-[var(--error)]">{tm("mfaDisabled")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {users.filter((u) => !u.mfaEnabled).length}
          </div>
        </div>
      </div>

      {/* User List */}
      <div className="space-y-4">
        {users.map((user) => (
          <div key={user.id} className="border border-[var(--border-subtle)] rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-medium text-[var(--text-primary)]">{user.name}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">{user.email}</p>
                  </div>
                  <Badge variant={ROLE_VARIANT[user.role] ?? "neutral"}>{user.role}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-4">
                  <Badge variant={user.mfaEnabled ? "success" : "error"}>
                    {tm("mfaStatus", { status: user.mfaEnabled ? tm("enabled") : tm("disabled") })}
                  </Badge>
                  {user.mfaEnabled && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      {tm("backupCodes", { count: user.backupCodesCount })}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedUser(user)}
                  aria-label={`View details for ${user.name}`}
                >
                  {tm("viewDetails")}
                </ActionButton>
                {user.mfaEnabled && hasPermission("user:manage_roles") && (
                  <ActionButton
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setDisableMfaTarget({ id: user.id, name: user.name });
                      setDisableMfaDialogOpen(true);
                    }}
                    loading={actionLoading === user.id}
                    aria-label={`Force disable MFA for ${user.name}`}
                  >
                    {tm("forceDisable")}
                  </ActionButton>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-[var(--bg-base)]/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface)] rounded-lg max-w-md w-full p-6 border border-[var(--border-default)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                {tm("details.title")}
              </h3>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => setSelectedUser(null)}
                aria-label={tc("close")}
              >
                {tc("close")}
              </ActionButton>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-sm font-medium text-[var(--text-secondary)]">
                  {tm("details.user")}
                </span>
                <div className="mt-1">
                  <div className="font-medium text-[var(--text-primary)]">{selectedUser.name}</div>
                  <div className="text-sm text-[var(--text-secondary)]">{selectedUser.email}</div>
                  <div className="text-sm text-[var(--text-secondary)]">
                    {tm("details.role", { role: selectedUser.role })}
                  </div>
                </div>
              </div>

              <div>
                <span className="text-sm font-medium text-[var(--text-secondary)]">
                  {tm("details.status")}
                </span>
                <div className="mt-1">
                  <Badge variant={selectedUser.mfaEnabled ? "success" : "error"}>
                    {selectedUser.mfaEnabled ? tm("enabled") : tm("disabled")}
                  </Badge>
                </div>
              </div>

              {selectedUser.mfaEnabled && (
                <div>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {tm("details.backupCodes")}
                  </span>
                  <div className="mt-1 text-sm text-[var(--text-primary)]">
                    {tm("details.codesRemaining", { count: selectedUser.backupCodesCount })}
                  </div>
                  {selectedUser.backupCodesCount < 3 && (
                    <div className="text-sm text-[var(--warning)] mt-1">{tm("lowBackupCodes")}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <InputDialog
        open={disableMfaDialogOpen}
        onOpenChange={(open) => {
          if (!open) setDisableMfaTarget(null);
          setDisableMfaDialogOpen(open);
        }}
        title="Disable MFA"
        description={disableMfaTarget ? `Force disable MFA for ${disableMfaTarget.name}` : ""}
        inputLabel="Reason"
        inputPlaceholder="e.g., User lost their authenticator device"
        onConfirm={async (reason) => {
          if (!disableMfaTarget || !reason.trim()) return;
          await handleForceDisableMfa(disableMfaTarget.id, reason);
          setDisableMfaTarget(null);
          setDisableMfaDialogOpen(false);
        }}
      />
    </div>
  );
}
