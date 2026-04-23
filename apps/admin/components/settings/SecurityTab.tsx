/**
 * @file SecurityTab.tsx
 * @description Encryption key rotation management for superadmins.
 *   Logs rotation events and provides instructions for updating the environment.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useId } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { toast } from "@packages/ui";

import { useRotateEncryption } from "@/hooks/api/useSettings";
import { ActionButton } from "../ui/ActionButton";
import { ConfirmDialog } from "@packages/ui";

/**
 * @component SecurityTab
 * @description Encryption key rotation UI with confirmation dialog and rotation note.
 */
export function SecurityTab() {
  const t = useTranslations("settings.security");
  const tc = useTranslations("common");

  const rotateMutation = useRotateEncryption();
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const noteInputId = useId();

  const handleRotate = useCallback(async () => {
    try {
      await rotateMutation.mutateAsync(note.trim() || undefined);
      toast({ title: tc("success"), description: t("rotateSuccess") });
      setNote("");
      setConfirmOpen(false);
    } catch {
      toast({ title: tc("error"), description: t("rotateError"), variant: "destructive" });
    }
  }, [note, rotateMutation, tc, t]);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{t("title")}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{t("description")}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md bg-[var(--warning-subtle)] p-3">
        <ShieldAlert className="h-5 w-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div className="text-sm text-[var(--text-primary)]">
          <p className="font-medium">{t("warning")}</p>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-[var(--text-secondary)]">
            <li>Log the rotation event below</li>
            <li>
              Update{" "}
              <code className="text-xs bg-[var(--bg-elevated)] px-1 rounded">
                PLATFORM_ENCRYPTION_KEY
              </code>{" "}
              in your .env
            </li>
            <li>Restart the API server</li>
            <li>Re-enter all credentials (existing ones will fail)</li>
          </ol>
        </div>
      </div>

      <div>
        <label
          htmlFor={noteInputId}
          className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
        >
          {t("noteLabel")}
        </label>
        <input
          id={noteInputId}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("notePlaceholder")}
          className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      </div>

      <ActionButton
        variant="danger"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        loading={rotateMutation.isPending}
      >
        {t("rotateButton")}
      </ActionButton>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        variant="danger"
        onConfirm={handleRotate}
      />
    </div>
  );
}
