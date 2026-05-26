/**
 * @file FolderSidebar.tsx
 * @description Folder navigation sidebar for asset library.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@packages/ui";
import { Folder, FolderPlus } from "lucide-react";
import { useAssetFolders, useCreateFolder } from "@/hooks/api/useAssets";

interface FolderSidebarProps {
  selectedFolderId: string | undefined;
  onSelectFolder: (folderId: string | undefined) => void;
}

/**
 * @component FolderSidebar
 * @description Sidebar navigation for the asset library listing all folders with an
 *              "All Assets" option and inline folder creation form.
 * @param props.selectedFolderId - Currently active folder ID, or undefined for all assets
 * @param props.onSelectFolder - Callback when a folder is selected
 */
export function FolderSidebar({ selectedFolderId, onSelectFolder }: FolderSidebarProps) {
  const t = useTranslations("assets.components");
  const { data: folders = [] } = useAssetFolders();
  const createFolderMutation = useCreateFolder();
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Focus the new-folder input when the inline create form opens.
  useEffect(() => {
    if (showCreate) {
      newFolderInputRef.current?.focus();
    }
  }, [showCreate]);

  const handleCreate = useCallback(async () => {
    if (!newFolderName.trim()) return;
    await createFolderMutation.mutateAsync({ name: newFolderName.trim() });
    setNewFolderName("");
    setShowCreate(false);
  }, [newFolderName, createFolderMutation]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onSelectFolder(undefined)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
          selectedFolderId === undefined
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent"
        }`}
      >
        <Folder className="h-4 w-4" />
        {t("allAssets")}
      </button>

      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          onClick={() => onSelectFolder(folder.id)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
            selectedFolderId === folder.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <Folder className="h-4 w-4" />
          {folder.name}
        </button>
      ))}

      {showCreate ? (
        <div className="px-2 pt-2 space-y-2">
          <Input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("folderNamePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowCreate(false);
            }}
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={handleCreate} disabled={!newFolderName.trim()}>
              {t("create")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent rounded-md"
        >
          <FolderPlus className="h-4 w-4" />
          {t("newFolder")}
        </button>
      )}
    </div>
  );
}
