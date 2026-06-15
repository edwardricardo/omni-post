/**
 * @file ABTestManager.tsx
 * @description Main A/B Test Manager component. Orchestrates sub-components for test creation,
 * overview, results display, and lifecycle management.
 * @component ABTestManager
 * @layer infrastructure
 *
 * Sub-components:
 * - ABTestCard (./ABTestCard.tsx) -- individual test card
 * - ABTestStatsCards (./ABTestStatsCards.tsx) -- summary statistics
 * - ABTestCreateDialog (./ABTestCreateDialog.tsx) -- creation dialog
 * - ABTestResultsTab (./ABTestResultsTab.tsx) -- completed test results
 * - useABTestManager (./useABTestManager.ts) -- state and handlers hook
 * - abTestTypes (./abTestTypes.ts) -- shared types
 */

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@packages/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@packages/ui";
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
import { Target } from "lucide-react";
import { type ABTestManagerProps } from "./abTestTypes";
import { ABTestCard } from "./ABTestCard";
import { ABTestStatsCards } from "./ABTestStatsCards";
import { ABTestCreateDialog } from "./ABTestCreateDialog";
import { ABTestResultsTab } from "./ABTestResultsTab";
import { useABTestManager } from "./useABTestManager";

export function ABTestManager({
  templates,
  onTestCreate,
  onTestUpdate: _onTestUpdate,
  onTestDelete,
  onTestStart,
  onTestPause,
  onTestStop,
  tests = [],
  allowManagement = true,
}: ABTestManagerProps) {
  const t = useTranslations("templates.components.abTest");
  const {
    activeTab,
    setActiveTab,
    setSelectedTest,
    createDialogOpen,
    setCreateDialogOpen,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    testToDelete,
    createForm,
    setCreateForm,
    runningTests,
    completedTests,
    draftTests,
    handleCreateTest,
    handleStartTest,
    handlePauseTest,
    handleStopTest,
    handleDeleteTest,
    confirmDelete,
    addVariant,
    removeVariant,
    updateVariantContent,
    updateTrafficSplit,
  } = useABTestManager({
    templates,
    onTestCreate,
    onTestDelete,
    onTestStart,
    onTestPause,
    onTestStop,
    tests,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("manager.title")}</h2>
          <p className="text-muted-foreground">{t("manager.subtitle")}</p>
        </div>
        {allowManagement && (
          <ABTestCreateDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            createForm={createForm}
            setCreateForm={setCreateForm}
            templates={templates}
            onCreateTest={handleCreateTest}
            onAddVariant={addVariant}
            onRemoveVariant={removeVariant}
            onUpdateVariantContent={updateVariantContent}
            onUpdateTrafficSplit={updateTrafficSplit}
          />
        )}
      </div>

      {/* Statistics Cards */}
      <ABTestStatsCards
        tests={tests}
        runningCount={runningTests.length}
        completedCount={completedTests.length}
        draftCount={draftTests.length}
      />

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">{t("manager.tabOverview")}</TabsTrigger>
          <TabsTrigger value="results">{t("manager.tabResults")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {tests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tests.map((test) => (
                <ABTestCard
                  key={test.id}
                  test={test}
                  allowManagement={allowManagement}
                  onStart={handleStartTest}
                  onPause={handlePauseTest}
                  onStop={handleStopTest}
                  onDelete={handleDeleteTest}
                  onSelect={setSelectedTest}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground">
                  <Target className="h-8 w-8 mx-auto mb-2" />
                  <p>{t("manager.emptyTitle")}</p>
                  <p className="text-sm">{t("manager.emptyDescription")}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          <ABTestResultsTab completedTests={completedTests} />
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("manager.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("manager.deleteDescription", { name: testToDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("manager.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("manager.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
