/**
 * @file InviteMemberModal.tsx
 * @component InviteMemberModal
 * @description Modal for inviting new team members with email and role.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { useInviteTeamMember } from "@/hooks/api/useTeam";

interface InviteMemberModalProps {
  accountId: string;
  invitedBy?: string;
  open: boolean;
  onClose: () => void;
}

const INVITE_ROLES = ["MEMBER", "MANAGER", "VIEWER"] as const;

export function InviteMemberModal({ accountId, invitedBy, open, onClose }: InviteMemberModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("MEMBER");

  const inviteMutation = useInviteTeamMember();

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit =
    email.trim().length > 0 && isValidEmail && name.trim().length > 0 && !inviteMutation.isPending;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      await inviteMutation.mutateAsync({
        accountId,
        email: email.trim(),
        name: name.trim(),
        role,
        ...(invitedBy ? { invitedBy } : {}),
      });

      setEmail("");
      setName("");
      setRole("MEMBER");
      onClose();
    },
    [accountId, email, name, role, invitedBy, canSubmit, inviteMutation, onClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md rounded-lg bg-card border shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Invite Team Member</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="invite-name">Name *</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="invite-email">Email *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@company.com"
            />
          </div>

          <div>
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Managers can invite members. Viewers have read-only access.
            </p>
          </div>

          {inviteMutation.isError && (
            <p role="alert" className="text-sm text-red-600">
              {inviteMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {inviteMutation.isPending ? "Inviting..." : "Send Invitation"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
