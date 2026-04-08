/**
 * @file CreateRoleDialog.tsx
 * @description Dialog for creating a new custom RBAC role with name, description,
 *   level, and initial permissions.
 * @layer presentation
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

import { api } from "../../lib/apiClient";

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

/**
 * @function CreateRoleDialog
 * @description Modal form for creating a new custom role with name, description, and level.
 */
export function CreateRoleDialog({ open, onOpenChange, onCreated }: CreateRoleDialogProps) {
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
        title: "Validation Error",
        description: "Name and description are required",
        variant: "destructive",
      });
      return;
    }
    if (level < 1 || level > 99) {
      toast({
        title: "Validation Error",
        description: "Level must be between 1 and 99",
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
      toast({ title: "Success", description: `Role ${trimmedName} created` });
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create role",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [name, description, level, resetForm, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Custom Role</DialogTitle>
          <DialogDescription>
            Define a new role with a name, description, and hierarchy level (1-99).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="role-name" className="text-xs">
              Name
            </Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="EDITOR"
              disabled={saving}
              className="uppercase"
            />
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              UPPER_SNAKE_CASE, e.g. CONTENT_EDITOR
            </p>
          </div>
          <div>
            <Label htmlFor="role-description" className="text-xs">
              Description
            </Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Can edit and publish content"
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="role-level" className="text-xs">
              Level (1 = lowest, 99 = highest)
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
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim() || !description.trim()}>
            {saving ? "Creating..." : "Create Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
