/**
 * @file VersionDetailDialog.tsx
 * @description Modal showing full details of a single content version (author, date, comment,
 *              body, tags) with View and Restore actions.
 * @component VersionDetailDialog
 * @layer infrastructure
 */

"use client";

import { format } from "date-fns";
import { RotateCcw } from "lucide-react";
import { Button } from "../button";
import { Badge } from "../badge";
import { Label } from "../label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../dialog";
import { ScrollArea } from "../scroll-area";
import type { ContentVersion } from "./contentVersioningTypes";
import { getTextContent, getAuthorName } from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionDetailDialogProps {
  /** The version to display, or `null` to close. */
  version: ContentVersion | null;
  /** The version number considered "current" (hides the Restore button). */
  currentVersion: number;
  /** Called when the dialog should close. */
  onClose: () => void;
  /** Called when the user clicks "Restore This Version". */
  onRestore: (version: ContentVersion) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionDetailDialog({
  version,
  currentVersion,
  onClose,
  onRestore,
}: VersionDetailDialogProps) {
  if (!version) return null;

  const isCurrentVersion = version.isCurrent || version.version === currentVersion;

  return (
    <Dialog open={!!version} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Version {version.version}
            {version.title && ` - ${version.title}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Author</Label>
              <p className="text-sm">{getAuthorName(version)}</p>
            </div>
            <div className="space-y-2">
              <Label>Created</Label>
              <p className="text-sm">{format(new Date(version.createdAt), "PPpp")}</p>
            </div>
          </div>

          {(version.comment || version.changeDescription) && (
            <div className="space-y-2">
              <Label>Comment</Label>
              <p className="text-sm p-2 bg-muted rounded-sm">
                {version.comment ?? version.changeDescription}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Content</Label>
            <ScrollArea className="h-40 border rounded-sm p-3">
              <p className="text-sm whitespace-pre-wrap">{getTextContent(version)}</p>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-1">
              {version.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {!isCurrentVersion && (
              <Button
                onClick={() => {
                  onRestore(version);
                  onClose();
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore This Version
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
