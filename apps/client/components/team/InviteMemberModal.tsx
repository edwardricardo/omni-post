/**
 * @file InviteMemberModal.tsx
 * @component InviteMemberModal
 * @description Modal for inviting new team members with email and role.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("team");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("MEMBER");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the name input when the modal opens.
  useEffect(() => {
    if (open) {
      nameInputRef.current?.focus();
    }
  }, [open]);

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
      <button
        type="button"
        aria-label={t("invite.closeModal")}
        className="fixed inset-0 bg-black/25 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-50 w-full max-w-md rounded-lg bg-card border shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-4">{t("invite.title")}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="invite-name">{t("invite.nameLabel")}</Label>
            <Input
              ref={nameInputRef}
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("invite.namePlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="invite-email">{t("invite.emailLabel")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("invite.emailPlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="invite-role">{t("invite.roleLabel")}</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">{t("invite.roleHint")}</p>
          </div>

          {inviteMutation.isError && (
            <p role="alert" className="text-sm text-red-600">
              {inviteMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {inviteMutation.isPending ? t("invite.submitting") : t("invite.submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
