/**
 * @file VersionCompareView.tsx
 * @component VersionCompareView
 * @description Inline compare tab content and full-screen compare dialog for template version diffs.
 * @layer infrastructure
 */

"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@packages/ui";
import { ScrollArea } from "@packages/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@packages/ui";
import { GitCompare } from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import { generateDiffFile } from "@git-diff-view/file";
import "@git-diff-view/react/styles/diff-view.css";
import type { TemplateVersion } from "./templateVersionControlTypes";

interface TemplateVersionDiffProps {
  left: TemplateVersion | undefined;
  right: TemplateVersion | undefined;
}

/**
 * @component TemplateVersionDiff
 * @description Renders a split diff of two template version contents.
 */
function TemplateVersionDiff({ left, right }: TemplateVersionDiffProps) {
  const diffFile = useMemo(() => {
    const file = generateDiffFile(
      `Version ${left?.version ?? ""}`,
      left?.content ?? "",
      `Version ${right?.version ?? ""}`,
      right?.content ?? "",
      "plaintext",
      "plaintext"
    );
    file.init();
    file.buildSplitDiffLines();
    return file;
  }, [left?.version, left?.content, right?.version, right?.content]);

  return (
    <DiffView
      diffFile={diffFile}
      diffViewMode={DiffModeEnum.Split}
      diffViewHighlight={false}
      diffViewWrap
      diffViewFontSize={12}
    />
  );
}

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
          <TemplateVersionDiff left={selectedVersionObjects[0]} right={selectedVersionObjects[1]} />
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
            <TemplateVersionDiff
              left={selectedVersionObjects[0]}
              right={selectedVersionObjects[1]}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
