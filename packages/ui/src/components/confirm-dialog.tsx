/**
 * @file confirm-dialog.tsx
 * @description Reusable confirm/cancel dialog built on AlertDialog.
 * Replaces native browser confirmation dialogs with an accessible, styled modal.
 * Shared across admin and client apps via `@packages/ui`.
 * @layer infrastructure
 */

"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog.js";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  children?: ReactNode;
}

/**
 * @component ConfirmDialog
 * @description A modal dialog that asks the user to confirm or cancel a destructive or important action.
 * @param props.title - Dialog heading text
 * @param props.description - Explanatory text shown below the title
 * @param props.variant - Visual style: "default" or "danger" for destructive actions
 * @param props.onConfirm - Callback invoked when the user confirms
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className={variant === "danger" ? "bg-[var(--error)] hover:opacity-90 text-white" : ""}
          >
            {loading ? "Processing..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
