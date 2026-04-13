/**
 * @file CreateBranchDialog.tsx
 * @component CreateBranchDialog
 * @description Dialog for creating a new version branch with name, description, and source version selection.
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
import { GitBranch } from "lucide-react";
import type { TemplateVersion } from "./templateVersionControlTypes";
import type { CreateBranchForm } from "./useTemplateVersionControl";

interface CreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: CreateBranchForm;
  onFormChange: React.Dispatch<React.SetStateAction<CreateBranchForm>>;
  onSubmit: () => Promise<void>;
  versions: TemplateVersion[];
}

export function CreateBranchDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  versions,
}: CreateBranchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center space-x-1">
          <GitBranch className="h-4 w-4" />
          <span>Create Branch</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Branch</DialogTitle>
          <DialogDescription>Create a new branch for parallel development</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch Name *</Label>
            <Input
              id="branch-name"
              value={form.name}
              onChange={(e) => onFormChange((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="feature/new-design"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch-description">Description</Label>
            <Textarea
              id="branch-description"
              value={form.description}
              onChange={(e) => onFormChange((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the purpose of this branch"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-version">From Version</Label>
            <Select
              value={form.fromVersion}
              onValueChange={(value) => onFormChange((prev) => ({ ...prev, fromVersion: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select starting version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    v{version.version} - {version.commitMessage || version.changeLog}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!form.name.trim()}>
            Create Branch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
