/**
 * @file PermissionGrid.tsx
 * @description Checkbox grid for managing role permissions organized by category.
 *   Displays all available permissions and allows toggling them on/off per role.
 * @layer presentation
 */

"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Save, ShieldAlert } from "lucide-react";
import { toast } from "@packages/ui";

import { api, type RoleInfo } from "../../lib/apiClient";
import { ActionButton } from "../ui/ActionButton";

/** Permission categories with their individual permissions */
const PERMISSION_CATEGORIES: Record<string, string[]> = {
  "User Management": [
    "user:create",
    "user:read",
    "user:update",
    "user:delete",
    "user:manage_roles",
  ],
  "Project Management": ["project:create", "project:read", "project:update", "project:delete"],
  "Content Management": [
    "content:create",
    "content:read",
    "content:update",
    "content:delete",
    "content:publish",
  ],
  Analytics: ["analytics:read", "analytics:export"],
  "System Administration": ["system:configure", "system:monitor", "system:backup"],
  "Audit & Compliance": ["audit:read", "audit:export"],
  Billing: ["billing:read", "billing:manage"],
  "AI Features": ["ai:use", "ai:configure"],
  Support: ["support:read", "support:respond"],
};

interface PermissionGridProps {
  role: RoleInfo;
  onPermissionsSaved: () => void;
}

export function PermissionGrid({ role, onPermissionsSaved }: PermissionGridProps) {
  const isSuperAdmin = role.role === "SUPER_ADMIN";
  const [editedPermissions, setEditedPermissions] = useState<string[]>(role.permissions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditedPermissions(role.permissions);
  }, [role.permissions]);

  const isDirty = useMemo(() => {
    if (isSuperAdmin) return false;
    const sorted1 = [...editedPermissions].sort();
    const sorted2 = [...role.permissions].sort();
    if (sorted1.length !== sorted2.length) return true;
    return sorted1.some((p, i) => p !== sorted2[i]);
  }, [editedPermissions, role.permissions, isSuperAdmin]);

  const handleToggle = useCallback((permission: string) => {
    setEditedPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]
    );
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const response = await api.security.rbac.setRolePermissions(role.id, editedPermissions);
      if (!response.ok) throw new Error("Failed to save permissions");
      toast({ title: "Success", description: "Permissions updated successfully" });
      onPermissionsSaved();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save permissions",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [role.id, editedPermissions, onPermissionsSaved]);

  const allPermissions = useMemo(() => Object.values(PERMISSION_CATEGORIES).flat(), []);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-[var(--text-secondary)]">
          Permissions ({editedPermissions.length})
        </h4>
        {!isSuperAdmin && (
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="text-[11px] text-[var(--warning)] font-medium">Unsaved changes</span>
            )}
            <ActionButton
              size="sm"
              variant="primary"
              disabled={!isDirty}
              loading={saving}
              onClick={handleSave}
            >
              <Save className="h-3 w-3" />
              Save Permissions
            </ActionButton>
          </div>
        )}
      </div>

      {isSuperAdmin && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--text-tertiary)]">
          <ShieldAlert className="h-3 w-3" />
          SUPER_ADMIN always has all permissions
        </div>
      )}

      <div className="space-y-3">
        {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]) => (
          <div key={category}>
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">{category}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {permissions.map((permission) => {
                const checked = isSuperAdmin
                  ? allPermissions.includes(permission)
                  : editedPermissions.includes(permission);
                return (
                  <label
                    key={permission}
                    className={[
                      "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border",
                      "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
                      isSuperAdmin
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer hover:bg-[var(--bg-elevated)]",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isSuperAdmin}
                      onChange={() => handleToggle(permission)}
                      className="h-3 w-3 rounded border-[var(--border-default)] accent-[var(--accent)]"
                    />
                    <span className="text-[var(--text-primary)] truncate">
                      {permission.split(":")[1]?.replace(/_/g, " ") ?? permission}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
