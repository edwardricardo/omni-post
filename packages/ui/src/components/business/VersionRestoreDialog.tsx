/**
 * @file VersionRestoreDialog.tsx
 * @description Confirmation alert dialog shown before restoring a content version, wrapping the
 *              shared AlertDialog primitive with standard copy and actions.
 * @component VersionRestoreDialog
 * @layer infrastructure
 */

"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../alert-dialog.js";
import type { ContentVersion } from "./contentVersioningTypes.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionToRestore: ContentVersion | null;
  onConfirm: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionRestoreDialog({
  open,
  onOpenChange,
  versionToRestore,
  onConfirm,
}: VersionRestoreDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore Version</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to restore to version {versionToRestore?.version}? This will
            replace your current content. You can always create a new version to save your current
            work first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Restore Version</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
