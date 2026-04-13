/**
 * @file VersionCompareView.tsx
 * @component VersionCompareView
 * @description Inline compare tab content and full-screen compare dialog for template version diffs.
 */

import { Card, CardContent } from "@packages/ui";
import { ScrollArea } from "@packages/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@packages/ui";
import { GitCompare } from "lucide-react";
import ReactDiffViewer from "react-diff-viewer";
import type { TemplateVersion } from "./templateVersionControlTypes";

const DIFF_STYLES = {
  contentText: {
    fontSize: "12px",
    fontFamily: "monospace",
  },
} as const;

interface VersionCompareTabProps {
  canCompare: boolean;
  selectedVersionObjects: TemplateVersion[];
}

export function VersionCompareTab({ canCompare, selectedVersionObjects }: VersionCompareTabProps) {
  if (!canCompare) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-muted-foreground">
            <GitCompare className="h-8 w-8 mx-auto mb-2" />
            <p>Select exactly 2 versions to compare.</p>
            <p className="text-sm">Use the checkboxes in the History tab to select versions.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Compare Versions</h3>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <span>v{selectedVersionObjects[0]?.version}</span>
          <span>vs</span>
          <span>v{selectedVersionObjects[1]?.version}</span>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <ReactDiffViewer
            oldValue={selectedVersionObjects[0]?.content || ""}
            newValue={selectedVersionObjects[1]?.content || ""}
            splitView={true}
            leftTitle={`Version ${selectedVersionObjects[0]?.version}`}
            rightTitle={`Version ${selectedVersionObjects[1]?.version}`}
            showDiffOnly={false}
            styles={DIFF_STYLES}
          />
        </CardContent>
      </Card>
    </div>
  );
}

interface VersionCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCompare: boolean;
  selectedVersionObjects: TemplateVersion[];
}

export function VersionCompareDialog({
  open,
  onOpenChange,
  canCompare,
  selectedVersionObjects,
}: VersionCompareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Version Comparison</DialogTitle>
          <DialogDescription>
            Comparing v{selectedVersionObjects[0]?.version} with v
            {selectedVersionObjects[1]?.version}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          {canCompare && (
            <ReactDiffViewer
              oldValue={selectedVersionObjects[0]?.content || ""}
              newValue={selectedVersionObjects[1]?.content || ""}
              splitView={true}
              leftTitle={`Version ${selectedVersionObjects[0]?.version}`}
              rightTitle={`Version ${selectedVersionObjects[1]?.version}`}
              showDiffOnly={false}
              styles={DIFF_STYLES}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
