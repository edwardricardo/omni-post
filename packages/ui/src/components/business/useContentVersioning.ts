/**
 * useContentVersioning -- custom hook encapsulating all state management and
 * business logic for the ContentVersioning orchestrator component.
 *
 * Extracts state declarations, filtering/sorting logic, and all event handlers
 * so that the main component file stays lean and focused on layout/rendering.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { ContentVersion, ContentVersioningProps } from "./contentVersioningTypes";
import { getAuthorName } from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Filter / sort state types
// ---------------------------------------------------------------------------

export interface VersionFilter {
  author?: string;
  changeType?: string;
  dateRange?: { start: string; end: string };
  status?: string;
}

export type SortMode = "newest" | "oldest" | "performance";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useContentVersioning(props: ContentVersioningProps) {
  const {
    currentContent = "",
    currentTitle,
    currentTags = [],
    currentVersion = 1,
    onVersionSelect,
    onVersionRestore,
    onNewVersion,
    onVersionDownload,
    showPerformanceData = false,
    showAdvancedFiltering = false,
    showCompareMode = true,
    maxVersionsToShow = 50,
    viewMode: initialViewMode = "timeline",
    versions: externalVersions,
    onNotification,
    contentId,
    postId,
  } = props;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ContentVersion | null>(null);
  const [showCreateVersionDialog, setShowCreateVersionDialog] = useState(false);
  const [newVersionComment, setNewVersionComment] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [compareVersions, setCompareVersions] = useState<{
    from: ContentVersion | null;
    to: ContentVersion | null;
  }>({ from: null, to: null });
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [versionToRestore, setVersionToRestore] = useState<ContentVersion | null>(null);
  const [selectedVersionIds, setSelectedVersionIds] = useState<Set<string>>(new Set());
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"timeline" | "tree" | "compact">(initialViewMode);
  const [filterBy, setFilterBy] = useState<VersionFilter>({});
  const [sortBy, setSortBy] = useState<SortMode>("newest");
  const [isLoading, _setIsLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Load versions
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (externalVersions) {
      setVersions(externalVersions);
    } else {
      // Future: fetch versions from API using contentId / postId
      setVersions([]);
    }
  }, [contentId, postId, externalVersions]);

  // -------------------------------------------------------------------------
  // Derived data: filtering + sorting
  // -------------------------------------------------------------------------

  const filteredVersions = versions.filter((version) => {
    if (filterBy.author) {
      const authorName = getAuthorName(version);
      const authorId = typeof version.author === "object" ? version.author.id : version.author;
      if (authorName !== filterBy.author && authorId !== filterBy.author) return false;
    }
    if (filterBy.changeType && version.changeType !== filterBy.changeType) return false;
    if (filterBy.status && version.status !== filterBy.status) return false;
    if (filterBy.dateRange) {
      const versionDate = new Date(version.createdAt);
      const startDate = new Date(filterBy.dateRange.start);
      const endDate = new Date(filterBy.dateRange.end);
      if (versionDate < startDate || versionDate > endDate) return false;
    }
    return true;
  });

  const sortedVersions = [...filteredVersions]
    .sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "performance": {
          const aPerf = a.performance?.engagement ?? 0;
          const bPerf = b.performance?.engagement ?? 0;
          return bPerf - aPerf;
        }
        case "newest":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    })
    .slice(0, maxVersionsToShow);

  const currentVersionData = versions.find((v) => v.isCurrent || v.version === currentVersion);

  // -------------------------------------------------------------------------
  // Notification helper
  // -------------------------------------------------------------------------

  const showNotification = useCallback(
    (notification: { title: string; description: string; type?: "success" | "error" }) => {
      onNotification?.(notification);
    },
    [onNotification]
  );

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleVersionSelect = useCallback(
    (version: ContentVersion) => {
      setSelectedVersion(version);
      onVersionSelect?.(version);
    },
    [onVersionSelect]
  );

  const handleCreateNewVersion = useCallback(() => {
    const newVersion: ContentVersion = {
      id: `v${versions.length + 1}`,
      version: versions.length + 1,
      ...(currentTitle && { title: currentTitle }),
      content: currentContent,
      summary: "Manual save",
      author: "Current User",
      createdAt: new Date(),
      tags: currentTags,
      isCurrent: true,
      ...(currentVersionData?.version && { parentVersion: currentVersionData.version }),
      changeType: "edit",
      comment: newVersionComment || "Manual version save",
    };

    const updatedVersions = versions.map((v) => ({
      ...v,
      isCurrent: false,
    }));

    setVersions([...updatedVersions, newVersion]);
    setNewVersionComment("");
    setShowCreateVersionDialog(false);
    onNewVersion?.(currentContent, newVersionComment);

    showNotification({
      title: "Version Created",
      description: `Version ${newVersion.version} has been saved successfully.`,
      type: "success",
    });
  }, [
    versions,
    currentTitle,
    currentContent,
    currentTags,
    currentVersionData,
    newVersionComment,
    onNewVersion,
    showNotification,
  ]);

  const handleRestoreVersion = useCallback((version: ContentVersion) => {
    setVersionToRestore(version);
    setRestoreDialogOpen(true);
  }, []);

  const confirmRestore = useCallback(() => {
    if (versionToRestore) {
      onVersionRestore?.(versionToRestore);
      setRestoreDialogOpen(false);
      setVersionToRestore(null);

      showNotification({
        title: "Version Restored",
        description: `Content has been restored to version ${versionToRestore.version}.`,
        type: "success",
      });
    }
  }, [versionToRestore, onVersionRestore, showNotification]);

  const handleCompareToggle = useCallback(
    (version: ContentVersion) => {
      if (!compareMode) {
        setCompareMode(true);
        setCompareVersions({ from: version, to: null });
      } else {
        if (!compareVersions.from) {
          setCompareVersions({ from: version, to: null });
        } else if (!compareVersions.to && version.id !== compareVersions.from.id) {
          setCompareVersions({ ...compareVersions, to: version });
        } else {
          setCompareMode(false);
          setCompareVersions({ from: null, to: null });
        }
      }
    },
    [compareMode, compareVersions]
  );

  const toggleVersionSelection = useCallback(
    (versionId: string) => {
      const newSelection = new Set(selectedVersionIds);
      if (newSelection.has(versionId)) {
        newSelection.delete(versionId);
      } else {
        newSelection.add(versionId);
      }
      setSelectedVersionIds(newSelection);
    },
    [selectedVersionIds]
  );

  const toggleVersionExpanded = useCallback(
    (versionId: string) => {
      const newExpanded = new Set(expandedVersions);
      if (newExpanded.has(versionId)) {
        newExpanded.delete(versionId);
      } else {
        newExpanded.add(versionId);
      }
      setExpandedVersions(newExpanded);
    },
    [expandedVersions]
  );

  const exitCompareMode = useCallback(() => {
    setCompareMode(false);
    setCompareVersions({ from: null, to: null });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedVersionIds(new Set());
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // State
    versions,
    sortedVersions,
    selectedVersion,
    showCreateVersionDialog,
    newVersionComment,
    compareMode,
    compareVersions,
    restoreDialogOpen,
    versionToRestore,
    selectedVersionIds,
    expandedVersions,
    viewMode,
    filterBy,
    sortBy,
    isLoading,
    currentVersion,

    // Props pass-through
    showPerformanceData,
    showAdvancedFiltering,
    showCompareMode,
    onVersionDownload,

    // Setters
    setSelectedVersion,
    setShowCreateVersionDialog,
    setNewVersionComment,
    setCompareMode,
    setRestoreDialogOpen,
    setViewMode,
    setFilterBy,
    setSortBy,

    // Handlers
    handleVersionSelect,
    handleCreateNewVersion,
    handleRestoreVersion,
    confirmRestore,
    handleCompareToggle,
    toggleVersionSelection,
    toggleVersionExpanded,
    exitCompareMode,
    clearSelection,
  };
}
