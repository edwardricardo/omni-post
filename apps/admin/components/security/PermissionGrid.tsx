/**
 * @file PermissionGrid.tsx
 * @description Checkbox grid for managing role permissions organized by category.
 *   Displays all available permissions and allows toggling them on/off per role.
 * @layer presentation
 */

"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Save, ShieldAlert, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";

import { ApiError, getErrorMessage } from "@/lib/parseApiError";
import { api, type RoleInfo } from "../../lib/apiClient";
import { ActionButton } from "../ui/ActionButton";

/** Permission category keys mapped to their individual permissions */
const CATEGORY_KEYS: Record<string, string[]> = {
  userManagement: ["user:read", "user:manage", "user:manage_roles"],
  accountManagement: ["account:read", "account:manage"],
  billingSubscriptions: ["billing:read", "billing:manage"],
  pricing: ["pricing:manage"],
  analytics: ["analytics:read", "analytics:export"],
  system: ["system:configure", "system:monitor"],
  auditCompliance: ["audit:read", "audit:export"],
  webhooks: ["webhook:manage"],
};

interface PermissionGridProps {
  role: RoleInfo;
  onPermissionsSaved: () => void;
}

/**
 * @component PermissionGrid
 * @description Checkbox grid for managing a role's permissions organized by category.
 *   Displays all available permissions and allows toggling them on/off with a save action.
 * @param props.role - The role whose permissions are being edited
 * @param props.onPermissionsSaved - Callback invoked after permissions are successfully saved
 */
export function PermissionGrid({ role, onPermissionsSaved }: PermissionGridProps) {
  const tp = useTranslations("security.permissions");
  const tc = useTranslations("common");
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
      if (!response.ok) throw new ApiError(0, null, "Failed to save permissions");
      toast({ title: tc("success"), description: tp("successSaved") });
      onPermissionsSaved();
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [role.id, editedPermissions, onPermissionsSaved, tc, tp]);

  const allPermissions = useMemo(() => Object.values(CATEGORY_KEYS).flat(), []);
  const categories = useMemo(
    () =>
      Object.entries(CATEGORY_KEYS).map(([key, permissions]) => ({
        key,
        label: tp(`categories.${key}`),
        permissions,
      })),
    [tp]
  );
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set(Object.keys(CATEGORY_KEYS).slice(1))
  );

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const getCategoryCount = useCallback(
    (permissions: string[]) => {
      if (isSuperAdmin) return permissions.length;
      return permissions.filter((p) => editedPermissions.includes(p)).length;
    },
    [isSuperAdmin, editedPermissions]
  );

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-[var(--text-secondary)]">
          {tp("title", { count: editedPermissions.length })}
        </h4>
        {!isSuperAdmin && (
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="text-[11px] text-[var(--warning)] font-medium">
                {tp("unsavedChanges")}
              </span>
            )}
            <ActionButton
              size="sm"
              variant="primary"
              disabled={!isDirty}
              loading={saving}
              onClick={handleSave}
            >
              <Save className="h-3 w-3" />
              {tp("savePermissions")}
            </ActionButton>
          </div>
        )}
      </div>

      {isSuperAdmin && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--text-tertiary)]">
          <ShieldAlert className="h-3 w-3" />
          {tp("superAdminNote")}
        </div>
      )}

      <div className="space-y-1">
        {categories.map(({ key, label, permissions }) => {
          const collapsed = collapsedCategories.has(key);
          const activeCount = getCategoryCount(permissions);

          return (
            <div key={key} className="rounded-md border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => toggleCategory(key)}
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-elevated)] rounded-md transition-colors"
              >
                {collapsed ? (
                  <ChevronRight className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
                )}
                <span className="text-xs font-medium text-[var(--text-secondary)] flex-1">
                  {label}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {activeCount}/{permissions.length}
                </span>
              </button>

              {!collapsed && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 px-2.5 pb-2">
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
