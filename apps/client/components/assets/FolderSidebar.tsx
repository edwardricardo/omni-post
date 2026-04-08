/**
 * @file FolderSidebar.tsx
 * @description Folder navigation sidebar for asset library.
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input } from "@packages/ui";
import { Folder, FolderPlus } from "lucide-react";
import { useAssetFolders, useCreateFolder } from "@/hooks/api/useAssets";

interface FolderSidebarProps {
  selectedFolderId: string | undefined;
  onSelectFolder: (folderId: string | undefined) => void;
}

export function FolderSidebar({ selectedFolderId, onSelectFolder }: FolderSidebarProps) {
  const { data: folders = [] } = useAssetFolders();
  const createFolderMutation = useCreateFolder();
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

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
        All Assets
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
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowCreate(false);
            }}
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={handleCreate} disabled={!newFolderName.trim()}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
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
          New Folder
        </button>
      )}
    </div>
  );
}
