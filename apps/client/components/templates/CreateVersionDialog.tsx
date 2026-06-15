/**
 * @file CreateVersionDialog.tsx
 * @component CreateVersionDialog
 * @description Dialog for creating a new template version with commit message, change log, and branch selection.
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
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
import type { VersionBranch } from "./templateVersionControlTypes.js";
import type { CreateVersionForm } from "./useTemplateVersionControl.js";

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
  const t = useTranslations("templates.components.versionControl");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center space-x-1">
          <GitCommit className="h-4 w-4" />
          <span>{t("createVersion")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createDialogTitle")}</DialogTitle>
          <DialogDescription>{t("createDialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="commit-message">{t("commitMessage")}</Label>
            <Input
              id="commit-message"
              value={form.commitMessage}
              onChange={(e) => onFormChange((prev) => ({ ...prev, commitMessage: e.target.value }))}
              placeholder={t("commitMessagePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-log">{t("changeLog")}</Label>
            <Textarea
              id="change-log"
              value={form.changeLog}
              onChange={(e) => onFormChange((prev) => ({ ...prev, changeLog: e.target.value }))}
              placeholder={t("changeLogPlaceholder")}
              rows={3}
            />
          </div>
          {allowBranching && (
            <div className="space-y-2">
              <Label htmlFor="branch-select">{t("branch")}</Label>
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
            {t("cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!form.changeLog.trim()}>
            {t("createVersion")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
