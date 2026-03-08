/**
 * @file CreateVersionDialog.tsx
 * @description Dialog for creating a new template version with commit message, change log, and branch selection.
 */

import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Textarea } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@packages/ui";
import { GitCommit } from "lucide-react";
import type { VersionBranch } from "./templateVersionControlTypes";
import type { CreateVersionForm } from "./useTemplateVersionControl";

interface CreateVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: CreateVersionForm;
  onFormChange: React.Dispatch<React.SetStateAction<CreateVersionForm>>;
  onSubmit: () => Promise<void>;
  allowBranching: boolean;
  branches: VersionBranch[];
}

export function CreateVersionDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  allowBranching,
  branches,
}: CreateVersionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center space-x-1">
          <GitCommit className="h-4 w-4" />
          <span>Create Version</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Version</DialogTitle>
          <DialogDescription>Create a new version of this template</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="commit-message">Commit Message</Label>
            <Input
              id="commit-message"
              value={form.commitMessage}
              onChange={(e) => onFormChange((prev) => ({ ...prev, commitMessage: e.target.value }))}
              placeholder="Brief summary of changes"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-log">Change Log *</Label>
            <Textarea
              id="change-log"
              value={form.changeLog}
              onChange={(e) => onFormChange((prev) => ({ ...prev, changeLog: e.target.value }))}
              placeholder="Describe what changed in this version"
              rows={3}
            />
          </div>
          {allowBranching && (
            <div className="space-y-2">
              <Label htmlFor="branch-select">Branch</Label>
              <Select
                value={form.branchName}
                onValueChange={(value) => onFormChange((prev) => ({ ...prev, branchName: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  {branches
                    .filter((b) => !b.isMain)
                    .map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        {branch.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!form.changeLog.trim()}>
            Create Version
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
