/**
 * @file ChangePasswordDialog.tsx
 * @description Dialog for changing the current admin user's own password.
 *   Validates password requirements (min 12 chars, uppercase, number)
 *   and delegates to useChangePassword mutation.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@packages/ui";
import { useChangePassword } from "@/hooks/api/useChangePassword";
import { getErrorMessage } from "@/lib/parseApiError";
import { ActionButton } from "@/components/ui/ActionButton";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * @component ChangePasswordDialog
 * @description Modal dialog for the currently logged-in admin to change their own password.
 * @param props.open - Whether the dialog is visible
 * @param props.onOpenChange - Callback to toggle visibility
 */
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const ts = useTranslations("security");
  const tc = useTranslations("common");
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState("");

  const resetForm = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setValidationError("");
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError("");

      if (newPassword !== confirmPassword) {
        setValidationError(ts("changePassword.passwordsMismatch"));
        return;
      }
      if (newPassword.length < 12) {
        setValidationError(ts("changePassword.minLength"));
        return;
      }
      if (!/[A-Z]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireUppercase"));
        return;
      }
      if (!/[0-9]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireNumber"));
        return;
      }

      changePassword.mutate(
        { currentPassword, newPassword },
        {
          onSuccess: () => {
            resetForm();
            onOpenChange(false);
          },
        }
      );
    },
    [currentPassword, newPassword, confirmPassword, changePassword, ts, resetForm, onOpenChange]
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{ts("changePassword.title")}</DialogTitle>
          <DialogDescription>{ts("changePassword.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="cp-current"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              {ts("changePassword.currentPassword")}
            </label>
            <input
              id="cp-current"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="cp-new"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              {ts("changePassword.newPassword")}
            </label>
            <input
              id="cp-new"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="cp-confirm"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              {ts("changePassword.confirmPassword")}
            </label>
            <input
              id="cp-confirm"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          {validationError && (
            <p className="text-sm text-[var(--error)]" role="alert">
              {validationError}
            </p>
          )}
          {changePassword.isError && (
            <p className="text-sm text-[var(--error)]" role="alert">
              {getErrorMessage(changePassword.error)}
            </p>
          )}
          <DialogFooter>
            <ActionButton
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => handleOpenChange(false)}
            >
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              type="submit"
              loading={changePassword.isPending}
            >
              {ts("changePassword.button")}
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
