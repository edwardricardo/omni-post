/**
 * @file CreateRoleDialog.tsx
 * @description Dialog for creating a new custom RBAC role with name, description,
 *   level, and initial permissions.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
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
import { toast } from "@packages/ui";
import { useTranslations } from "next-intl";

import { getErrorMessage } from "@packages/api-errors";
import { api } from "../../lib/apiClient.js";

interface CreateRoleDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Fired to toggle dialog visibility, mirroring the Radix Dialog API. */
  onOpenChange: (open: boolean) => void;
  /** Fired after a role is successfully created so callers can refresh lists. */
  onCreated: () => void;
}

/**
 * @component CreateRoleDialog
 * @description Modal form for creating a new custom RBAC role with name, description, and level.
 * @param props.open - Whether the dialog is currently visible
 * @param props.onOpenChange - Callback to toggle dialog visibility
 * @param props.onCreated - Callback invoked after a role is successfully created
 */
export function CreateRoleDialog({ open, onOpenChange, onCreated }: CreateRoleDialogProps) {
  const tcr = useTranslations("security.createRole");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState(50);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setLevel(50);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetForm();
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim().toUpperCase().replace(/\s+/g, "_");
    if (!trimmedName || !description.trim()) {
      toast({
        title: tcr("validationError"),
        description: tcr("nameRequired"),
        variant: "destructive",
      });
      return;
    }
    if (level < 1 || level > 99) {
      toast({
        title: tcr("validationError"),
        description: tcr("levelRange"),
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await api.security.rbac.createRole({
        name: trimmedName,
        description: description.trim(),
        level,
        permissions: [],
      });
      if (!response.ok) throw new Error("Failed to create role");
      toast({ title: tc("success"), description: tcr("created", { name: trimmedName }) });
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [name, description, level, resetForm, onOpenChange, onCreated, tcr, tc]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tcr("title")}</DialogTitle>
          <DialogDescription>{tcr("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="role-name" className="text-xs">
              {tcr("nameLabel")}
            </Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tcr("namePlaceholder")}
              disabled={saving}
              className="uppercase"
            />
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{tcr("nameHint")}</p>
          </div>
          <div>
            <Label htmlFor="role-description" className="text-xs">
              {tcr("descriptionLabel")}
            </Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tcr("descriptionPlaceholder")}
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="role-level" className="text-xs">
              {tcr("levelLabel")}
            </Label>
            <Input
              id="role-level"
              type="number"
              min={1}
              max={99}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim() || !description.trim()}>
            {saving ? tcr("creating") : tcr("createButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
