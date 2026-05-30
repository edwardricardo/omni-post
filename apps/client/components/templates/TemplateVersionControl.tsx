"use client";

/**
 * @file TemplateVersionControl.tsx
 * @description Main orchestrator component for template version control.
 * Sub-components, hooks, and types are split into separate modules.
 * @component TemplateVersionControl
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@packages/ui";
import { Button } from "@packages/ui";
import { Label } from "@packages/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@packages/ui";
import { Separator } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@packages/ui";
import { GitBranch, GitCompare, History } from "lucide-react";
import type { TemplateVersionControlProps } from "./templateVersionControlTypes";
import { useTemplateVersionControl } from "./useTemplateVersionControl";
import { VersionCard } from "./VersionCard";
import { BranchCard } from "./BranchCard";
import { VersionCompareTab, VersionCompareDialog } from "./VersionCompareView";
import { CreateVersionDialog } from "./CreateVersionDialog";
import { CreateBranchDialog } from "./CreateBranchDialog";

export function TemplateVersionControl({
  template,
  versions,
  branches = [],
  onVersionRestore,
  onVersionDelete,
  onVersionCreate,
  onBranchCreate,
  onBranchMerge,
  allowVersioning = true,
  allowBranching = false,
  currentUser = { id: "user-1", name: "Current User" },
}: TemplateVersionControlProps) {
  const t = useTranslations("templates.components.versionControl");
  const {
    activeTab,
    setActiveTab,
    selectedVersions,
    selectedBranch,
    setSelectedBranch,
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
    versionToRestore,
    versionToDelete,
    createVersionForm,
    setCreateVersionForm,
    createBranchForm,
    setCreateBranchForm,
    sortedVersions,
    activeVersion,
    canCompare,
    selectedVersionObjects,
    handleVersionSelect,
    handleRestoreVersion,
    confirmRestore,
    handleDeleteVersion,
    confirmDelete,
    handleCreateVersion,
    handleCreateBranch,
    handleMergeBranch,
  } = useTemplateVersionControl({
    template,
    versions,
    onVersionRestore,
    onVersionDelete,
    onVersionCreate,
    onBranchCreate,
    onBranchMerge,
    currentUser,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center space-x-2">
          {allowVersioning && (
            <CreateVersionDialog
              open={createVersionDialogOpen}
              onOpenChange={setCreateVersionDialogOpen}
              form={createVersionForm}
              onFormChange={setCreateVersionForm}
              onSubmit={handleCreateVersion}
              allowBranching={allowBranching}
              branches={branches}
            />
          )}

          {allowBranching && (
            <CreateBranchDialog
              open={createBranchDialogOpen}
              onOpenChange={setCreateBranchDialogOpen}
              form={createBranchForm}
              onFormChange={setCreateBranchForm}
              onSubmit={handleCreateBranch}
              versions={versions}
            />
          )}
        </div>
      </div>

      {/* Current Status */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div>
                <p className="text-sm font-medium">{t("currentVersion")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("versionOnBranch", {
                    version: activeVersion?.version ?? t("unknown"),
                    branch: selectedBranch,
                  })}
                </p>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <p className="text-sm font-medium">{t("totalVersions")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("versionCount", { count: sortedVersions.length })}
                </p>
              </div>
              {allowBranching && (
                <>
                  <Separator orientation="vertical" className="h-8" />
                  <div>
                    <p className="text-sm font-medium">{t("branches")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("branchCount", { count: branches.length })}
                    </p>
                  </div>
                </>
              )}
            </div>
            {canCompare && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompareDialogOpen(true)}
                className="flex items-center space-x-1"
              >
                <GitCompare className="h-3 w-3" />
                <span>{t("compareSelected")}</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="history" className="flex items-center space-x-1">
            <History className="h-4 w-4" />
            <span>{t("tabHistory")}</span>
          </TabsTrigger>
          {allowBranching && (
            <TabsTrigger value="branches" className="flex items-center space-x-1">
              <GitBranch className="h-4 w-4" />
              <span>{t("tabBranches")}</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="compare" className="flex items-center space-x-1">
            <GitCompare className="h-4 w-4" />
            <span>{t("tabCompare")}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4">
          {/* Branch selector */}
          {allowBranching && branches.length > 0 && (
            <div className="flex items-center space-x-2">
              <Label>{t("branchLabel")}</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-40">
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

          {/* Version list */}
          {sortedVersions.length > 0 ? (
            <div className="space-y-2">
              {sortedVersions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  selectedVersions={selectedVersions}
                  allowVersioning={allowVersioning}
                  onVersionSelect={handleVersionSelect}
                  onRestore={handleRestoreVersion}
                  onDelete={handleDeleteVersion}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground">
                  <History className="h-8 w-8 mx-auto mb-2" />
                  <p>{t("noVersionsTitle")}</p>
                  <p className="text-sm">{t("noVersionsDescription")}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {allowBranching && (
          <TabsContent value="branches" className="space-y-4">
            {branches.length > 0 ? (
              <div className="space-y-2">
                {branches.map((branch) => (
                  <BranchCard
                    key={branch.name}
                    branch={branch}
                    allowBranching={allowBranching}
                    onSwitchBranch={setSelectedBranch}
                    onMergeBranch={handleMergeBranch}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="text-muted-foreground">
                    <GitBranch className="h-8 w-8 mx-auto mb-2" />
                    <p>{t("noBranchesTitle")}</p>
                    <p className="text-sm">{t("noBranchesDescription")}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="compare" className="space-y-4">
          <VersionCompareTab
            canCompare={canCompare}
            selectedVersionObjects={selectedVersionObjects}
          />
        </TabsContent>
      </Tabs>

      {/* Compare Dialog */}
      <VersionCompareDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        canCompare={canCompare}
        selectedVersionObjects={selectedVersionObjects}
      />

      {/* Restore Confirmation */}
      <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("restoreDescription", { version: versionToRestore?.version ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>{t("restore")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { version: versionToDelete?.version ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
