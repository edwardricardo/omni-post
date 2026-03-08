/**
 * ContentVersioning -- orchestrator component for version history management.
 *
 * This file is the public entry point.  It re-exports types from
 * `contentVersioningTypes` for backwards-compatibility with consumers that
 * `import { ContentVersion, ContentVersioningProps } from "./ContentVersioning"`.
 *
 * All heavy logic lives in dedicated sub-modules:
 *   - useContentVersioning  (hook -- state + handlers)
 *   - VersionTimelineView   (timeline tab)
 *   - VersionCompactView    (compact / "All Versions" tab)
 *   - VersionCompareView    (side-by-side diff tab)
 *   - VersionDetailDialog   (single-version detail modal)
 *   - VersionRestoreDialog  (restore confirmation alert)
 *   - VersionFilterBar      (advanced filters + selection bar)
 */

"use client";

import { History, Save, Diff, GitBranch } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Button } from "../button";
import { Label } from "../label";
import { Textarea } from "../textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import { ScrollArea } from "../scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../dialog";

// Sub-modules
import { useContentVersioning } from "./useContentVersioning";
import { VersionTimelineView } from "./VersionTimelineView";
import { VersionCompactView } from "./VersionCompactView";
import { VersionCompareView } from "./VersionCompareView";
import { VersionDetailDialog } from "./VersionDetailDialog";
import { VersionRestoreDialog } from "./VersionRestoreDialog";
import { VersionFilterBar, VersionSelectionBar } from "./VersionFilterBar";

// Re-export types so existing `import { ContentVersion } from "./ContentVersioning"`
// and `export * from "./ContentVersioning"` in index.ts continue to work.
export type { ContentVersion, ContentVersioningProps } from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Props (re-imported locally for the function signature)
// ---------------------------------------------------------------------------

import type { ContentVersioningProps } from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function VersioningSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <GitBranch className="w-5 h-5 mr-2" />
          Content Versions
        </h3>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-4">
            <div className="animate-pulse space-y-3">
              <div className="flex items-center space-x-3">
                <div className="w-4 h-4 bg-gray-300 rounded-sm"></div>
                <div className="h-4 bg-gray-300 rounded-sm w-24"></div>
                <div className="h-4 bg-gray-300 rounded-sm w-20"></div>
              </div>
              <div className="h-4 bg-gray-300 rounded-sm w-3/4"></div>
              <div className="h-16 bg-gray-300 rounded-sm"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContentVersioning(props: ContentVersioningProps) {
  const {
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
  } = useContentVersioning(props);

  if (isLoading) {
    return <VersioningSkeleton />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Version History
              </CardTitle>
              <CardDescription>
                Track changes and manage different versions of your content
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {compareMode && showCompareMode && (
                <Button variant="outline" onClick={exitCompareMode}>
                  Exit Compare
                </Button>
              )}
              {props.showCreateVersion !== false && (
                <Dialog open={showCreateVersionDialog} onOpenChange={setShowCreateVersionDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Save className="h-4 w-4 mr-2" />
                      Save Version
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Version</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="comment">Version Comment (Optional)</Label>
                        <Textarea
                          id="comment"
                          placeholder="Describe the changes in this version..."
                          value={newVersionComment}
                          onChange={(e) => setNewVersionComment(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowCreateVersionDialog(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleCreateNewVersion}>Create Version</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Advanced Filtering */}
          {showAdvancedFiltering && (
            <VersionFilterBar
              versions={versions}
              filterBy={filterBy}
              sortBy={sortBy}
              showPerformanceData={showPerformanceData}
              onFilterChange={setFilterBy}
              onSortChange={setSortBy}
            />
          )}

          {/* Selection Bar */}
          {showAdvancedFiltering && (
            <VersionSelectionBar
              selectedCount={selectedVersionIds.size}
              selectedVersionIds={selectedVersionIds}
              {...(props.onVersionCompare && { onCompareSelected: props.onVersionCompare })}
              onClearSelection={clearSelection}
            />
          )}

          {/* Tab views */}
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as typeof viewMode)}
            className="space-y-4"
          >
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="compact">All Versions</TabsTrigger>
              {compareVersions.from && compareVersions.to && showCompareMode && (
                <TabsTrigger value="compare">Compare</TabsTrigger>
              )}
            </TabsList>

            {/* Timeline View */}
            <TabsContent value="timeline" className="space-y-4">
              <ScrollArea className="h-96">
                <VersionTimelineView
                  versions={sortedVersions}
                  currentVersion={currentVersion}
                  compareMode={compareMode}
                  compareVersions={compareVersions}
                  showMediaSupport={props.showMediaSupport ?? false}
                  showPerformanceData={showPerformanceData}
                  onVersionSelect={handleVersionSelect}
                  onRestoreVersion={handleRestoreVersion}
                  onCompareToggle={handleCompareToggle}
                />
              </ScrollArea>

              {showCompareMode && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setCompareMode(!compareMode)}>
                    <Diff className="h-4 w-4 mr-2" />
                    {compareMode ? "Exit Compare Mode" : "Compare Versions"}
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* All Versions (Compact) */}
            <TabsContent value="compact" className="space-y-4">
              <VersionCompactView
                versions={sortedVersions}
                currentVersion={currentVersion}
                selectedVersionIds={selectedVersionIds}
                expandedVersionIds={expandedVersions}
                showAdvancedFiltering={showAdvancedFiltering}
                showPerformanceData={showPerformanceData}
                onVersionSelect={handleVersionSelect}
                onRestoreVersion={handleRestoreVersion}
                {...(onVersionDownload && { onVersionDownload })}
                onToggleSelection={toggleVersionSelection}
                onToggleExpanded={toggleVersionExpanded}
              />
            </TabsContent>

            {/* Compare View */}
            {compareVersions.from && compareVersions.to && showCompareMode && (
              <TabsContent value="compare" className="space-y-4">
                <VersionCompareView from={compareVersions.from} to={compareVersions.to} />
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>

      {/* Version Details Dialog */}
      <VersionDetailDialog
        version={selectedVersion}
        currentVersion={currentVersion}
        onClose={() => setSelectedVersion(null)}
        onRestore={handleRestoreVersion}
      />

      {/* Restore Confirmation Dialog */}
      <VersionRestoreDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        versionToRestore={versionToRestore}
        onConfirm={confirmRestore}
      />
    </div>
  );
}
