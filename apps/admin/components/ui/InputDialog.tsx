/**
 * @file InputDialog.tsx
 * @description A dialog with a text input field built on Dialog from @packages/ui.
 * Replaces native browser text input dialogs with an accessible, styled modal.
 * @layer presentation
 */

"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@packages/ui";

interface InputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder?: string;
  onConfirm: (value: string) => void | Promise<void>;
  loading?: boolean;
}

/**
 * @function InputDialog
 * @description A modal dialog that prompts the user for text input before confirming.
 * @param props - Dialog configuration and callback handlers
 */
export function InputDialog({
  open,
  onOpenChange,
  title,
  description,
  inputLabel,
  inputPlaceholder = "",
  onConfirm,
  loading = false,
}: InputDialogProps) {
  const [value, setValue] = useState("");

  const handleConfirm = async () => {
    if (!value.trim()) return;
    await onConfirm(value.trim());
    setValue("");
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setValue("");
    }
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
          <Label htmlFor="input-dialog-field">{inputLabel}</Label>
          <Input
            id="input-dialog-field"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={inputPlaceholder}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                handleConfirm();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !value.trim()}>
            {loading ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
