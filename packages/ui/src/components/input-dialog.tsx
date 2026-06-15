/**
 * @file input-dialog.tsx
 * @description A dialog with a text input field built on Dialog.
 * Replaces native browser text input dialogs with an accessible, styled modal.
 * Shared across admin and client apps via `@packages/ui`.
 * @layer infrastructure
 */

"use client";

import { useId, useState } from "react";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import { Input } from "./input.js";
import { Label } from "./label.js";

interface InputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void | Promise<void>;
  loading?: boolean;
}

/**
 * @component InputDialog
 * @description A modal dialog that prompts the user for text input before confirming an action.
 */
export function InputDialog({
  open,
  onOpenChange,
  title,
  description,
  inputLabel,
  inputPlaceholder = "",
  initialValue = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  loading = false,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const fieldId = useId();

  const handleConfirm = async () => {
    if (!value.trim()) return;
    await onConfirm(value.trim());
    setValue(initialValue);
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setValue(initialValue);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={fieldId}>{inputLabel}</Label>
          <Input
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={inputPlaceholder}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                void handleConfirm();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !value.trim()}>
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
