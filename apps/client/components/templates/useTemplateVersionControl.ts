/**
 * @file useTemplateVersionControl.ts
 * @description Custom hook encapsulating all state management and handlers for the TemplateVersionControl component.
 * @hook useTemplateVersionControl
 * @layer infrastructure
 */

import { useState, useCallback, useMemo } from "react";
import { useToast } from "@packages/ui";
import type {
  TemplateVersion,
  VersionBranch,
  TemplateVersionControlProps,
} from "./templateVersionControlTypes.js";

export interface CreateVersionForm {
  changeLog: string;
  commitMessage: string;
  branchName: string;
  content: string;
}

export interface CreateBranchForm {
  name: string;
  description: string;
  fromVersion: string;
}

export type ActiveTab = "history" | "branches" | "compare";

interface UseTemplateVersionControlParams {
  template: TemplateVersionControlProps["template"];
  versions: TemplateVersionControlProps["versions"];
  onVersionRestore?: TemplateVersionControlProps["onVersionRestore"];
  onVersionDelete?: TemplateVersionControlProps["onVersionDelete"];
  onVersionCreate?: TemplateVersionControlProps["onVersionCreate"];
  onBranchCreate?: TemplateVersionControlProps["onBranchCreate"];
  onBranchMerge?: TemplateVersionControlProps["onBranchMerge"];
  currentUser?: TemplateVersionControlProps["currentUser"];
}

export function useTemplateVersionControl({
  template,
  versions,
  onVersionRestore,
  onVersionDelete,
  onVersionCreate,
  onBranchCreate,
  onBranchMerge,
  currentUser = { id: "user-1", name: "Current User" },
}: UseTemplateVersionControlParams) {
  const { success, error } = useToast();

  // State
  const [activeTab, setActiveTab] = useState<ActiveTab>("history");
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [versionToRestore, setVersionToRestore] = useState<TemplateVersion | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<TemplateVersion | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");

  // Create version form
  const [createVersionForm, setCreateVersionForm] = useState<CreateVersionForm>({
    changeLog: "",
    commitMessage: "",
    branchName: "main",
    content: template.content,
  });

  // Create branch form
  const [createBranchForm, setCreateBranchForm] = useState<CreateBranchForm>({
    name: "",
    description: "",
    fromVersion: "",
  });

  // Computed values
  const sortedVersions = useMemo(() => {
    return [...versions]
      .filter(
        (v) =>
          !selectedBranch ||
          v.branchName === selectedBranch ||
          (!v.branchName && selectedBranch === "main")
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [versions, selectedBranch]);

  const activeVersion = useMemo(() => {
    return versions.find((v) => v.isActive);
  }, [versions]);

  const canCompare = selectedVersions.length === 2;

  const selectedVersionObjects = useMemo(() => {
    return selectedVersions
      .map((id) => versions.find((v) => v.id === id))
      .filter(Boolean) as TemplateVersion[];
  }, [selectedVersions, versions]);

  // Handlers
  const handleVersionSelect = useCallback((versionId: string, checked: boolean) => {
    setSelectedVersions((prev) => {
      if (checked) {
        if (prev.length >= 2) {
          const second = prev[1];
          return second !== undefined ? [second, versionId] : [versionId];
        }
        return [...prev, versionId];
      } else {
        return prev.filter((id) => id !== versionId);
      }
    });
  }, []);

  const handleRestoreVersion = useCallback((version: TemplateVersion) => {
    setVersionToRestore(version);
    setRestoreConfirmOpen(true);
  }, []);

  const confirmRestore = useCallback(async () => {
    if (versionToRestore) {
      try {
        await onVersionRestore?.(versionToRestore);
        success({ description: `Restored to version ${versionToRestore.version}` });
      } catch {
        error({ description: "Failed to restore version" });
      }
    }
    setRestoreConfirmOpen(false);
    setVersionToRestore(null);
  }, [versionToRestore, onVersionRestore, success, error]);

  const handleDeleteVersion = useCallback((version: TemplateVersion) => {
    setVersionToDelete(version);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (versionToDelete) {
      try {
        await onVersionDelete?.(versionToDelete.id);
        success({ description: `Deleted version ${versionToDelete.version}` });
      } catch {
        error({ description: "Failed to delete version" });
      }
    }
    setDeleteConfirmOpen(false);
    setVersionToDelete(null);
  }, [versionToDelete, onVersionDelete, success, error]);

  const handleCreateVersion = useCallback(async () => {
    try {
      if (!createVersionForm.changeLog.trim()) {
        error({ description: "Please provide a change log" });
        return;
      }

      const newVersion: Omit<TemplateVersion, "id" | "createdAt"> = {
        templateId: template.id,
        version: Math.max(...versions.map((v) => v.version), 0) + 1,
        content: createVersionForm.content,
        variables: template.variables?.map((v) => v.name) || [],
        platforms: template.platforms,
        tags: template.tags || [],
        changeLog: createVersionForm.changeLog,
        author: currentUser,
        isActive: false,
        branchName: createVersionForm.branchName,
        commitMessage: createVersionForm.commitMessage,
      };

      await onVersionCreate?.(newVersion);

      setCreateVersionForm({
        changeLog: "",
        commitMessage: "",
        branchName: "main",
        content: template.content,
      });

      setCreateVersionDialogOpen(false);
      success({ description: "New version created successfully" });
    } catch {
      error({ description: "Failed to create version" });
    }
  }, [createVersionForm, template, versions, currentUser, onVersionCreate, success, error]);

  const handleCreateBranch = useCallback(async () => {
    try {
      if (!createBranchForm.name.trim()) {
        error({ description: "Please provide a branch name" });
        return;
      }

      const newBranch: Omit<VersionBranch, "latestVersion" | "versionCount" | "createdAt"> = {
        name: createBranchForm.name,
        description: createBranchForm.description,
        isMain: false,
        author: currentUser,
      };

      await onBranchCreate?.(newBranch);

      setCreateBranchForm({
        name: "",
        description: "",
        fromVersion: "",
      });

      setCreateBranchDialogOpen(false);
      success({ description: "New branch created successfully" });
    } catch {
      error({ description: "Failed to create branch" });
    }
  }, [createBranchForm, currentUser, onBranchCreate, success, error]);

  const handleMergeBranch = useCallback(
    async (sourceBranch: string, targetBranch: string) => {
      try {
        await onBranchMerge?.(sourceBranch, targetBranch);
        success({ description: `Merged ${sourceBranch} into ${targetBranch}` });
      } catch {
        error({ description: "Failed to merge branch" });
      }
    },
    [onBranchMerge, success, error]
  );

  return {
    // Tab state
    activeTab,
    setActiveTab,

    // Selection state
    selectedVersions,
    selectedBranch,
    setSelectedBranch,

    // Dialog state
    compareDialogOpen,
    setCompareDialogOpen,
    createVersionDialogOpen,
    setCreateVersionDialogOpen,
    createBranchDialogOpen,
    setCreateBranchDialogOpen,
    restoreConfirmOpen,
    setRestoreConfirmOpen,
    deleteConfirmOpen,
    setDeleteConfirmOpen,

    // Version to act on
    versionToRestore,
    versionToDelete,

    // Forms
    createVersionForm,
    setCreateVersionForm,
    createBranchForm,
    setCreateBranchForm,

    // Computed
    sortedVersions,
    activeVersion,
    canCompare,
    selectedVersionObjects,

    // Handlers
    handleVersionSelect,
    handleRestoreVersion,
    confirmRestore,
    handleDeleteVersion,
    confirmDelete,
    handleCreateVersion,
    handleCreateBranch,
    handleMergeBranch,
  };
}
