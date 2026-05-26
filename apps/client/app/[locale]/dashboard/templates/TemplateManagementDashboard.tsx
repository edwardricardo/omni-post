"use client";

/**
 * @file TemplateManagementDashboard.tsx
 * @description Dashboard for managing content templates — tabs for library, editor, A/B testing,
 *              and version control, backed by template and A/B test hooks.
 * @component TemplateManagementDashboard
 * @layer infrastructure
 */
import React, { useState, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@packages/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import {
  TemplateLibrary,
  TemplateEditor,
  ABTestManager,
  TemplateVersionControl,
  Template,
  templateEngine,
} from "@/components/templates";
import { useTemplates } from "@/lib/hooks/useTemplates";
import { useABTests } from "@/lib/hooks/useABTests";
import { useProjects } from "@/lib/api/hooks";
import { useTemplateVersions } from "@/lib/hooks/useTemplateVersions";
import { useToast } from "@packages/ui";
import { useTranslations } from "next-intl";
import {
  FileText,
  TestTube,
  GitBranch,
  BarChart3,
  Plus,
  Lightbulb,
  Zap,
  Target,
} from "lucide-react";

interface TemplateManagementDashboardProps {
  projectId?: string;
}

export function TemplateManagementDashboard({
  projectId: projectIdProp,
}: TemplateManagementDashboardProps) {
  // Use provided projectId or fetch the first available project
  const { data: projectsData } = useProjects();
  const projectId = projectIdProp || projectsData?.data?.[0]?.id || "";
  const { success, error } = useToast();
  const t = useTranslations("templates");

  // State management
  const [activeTab, setActiveTab] = useState<
    "library" | "editor" | "ab-testing" | "versions" | "analytics"
  >("library");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");

  // Data hooks
  const {
    templates,
    isLoading: _templatesLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
  } = useTemplates(projectId);

  const {
    tests: abTests,
    isLoading: _abTestsLoading,
    createTest,
    updateTest,
    startTest,
    stopTest,
    deleteTest,
  } = useABTests(projectId);

  const {
    versions,
    isLoading: _versionsLoading,
    createVersion,
    restoreVersion,
    deleteVersion,
  } = useTemplateVersions(selectedTemplate?.id, projectId);

  // Template statistics
  const templateStats = useMemo(
    () => ({
      total: templates.length,
      active: templates.filter((t) => t.version && t.version > 0).length,
      draft: templates.filter((t) => !t.version || t.version === 0).length,
      categories: [...new Set(templates.map((t) => t.category))].length,
    }),
    [templates]
  );

  const abTestStats = useMemo(
    () => ({
      total: abTests.length,
      running: abTests.filter((t) => t.status === "running").length,
      completed: abTests.filter((t) => t.status === "completed").length,
      draft: abTests.filter((t) => t.status === "draft").length,
    }),
    [abTests]
  );

  // Event handlers
  const handleTemplateSelect = useCallback((template: Template) => {
    setSelectedTemplate(template);
    setEditorMode("edit");
    setActiveTab("editor");
  }, []);

  const handleTemplateEdit = useCallback((template: Template) => {
    setSelectedTemplate(template);
    setEditorMode("edit");
    setActiveTab("editor");
  }, []);

  const handleTemplateCreate = useCallback(() => {
    setSelectedTemplate(null);
    setEditorMode("create");
    setActiveTab("editor");
  }, []);

  const handleTemplateSave = useCallback(
    async (template: Template) => {
      try {
        if (editorMode === "create") {
          await createTemplate.mutateAsync({
            name: template.name,
            category: template.category,
            content: template.content,
            platforms: template.platforms,
            ...(template.description !== undefined && { description: template.description }),
            ...(template.tags !== undefined && { tags: template.tags }),
          });
          success({ description: t("dashboard.toast.createSuccess") });
        } else {
          await updateTemplate.mutateAsync({
            templateId: template.id,
            ...template,
          });
          success({ description: t("dashboard.toast.updateSuccess") });
        }
        setActiveTab("library");
      } catch {
        error({ description: t("dashboard.toast.saveError") });
      }
    },
    [editorMode, createTemplate, updateTemplate, success, error, t]
  );

  const handleTemplateDelete = useCallback(
    async (template: Template) => {
      try {
        await deleteTemplate.mutateAsync(template.id);
        success({ description: t("dashboard.toast.deleteSuccess") });
        if (selectedTemplate?.id === template.id) {
          setSelectedTemplate(null);
        }
      } catch {
        error({ description: t("dashboard.toast.deleteError") });
      }
    },
    [deleteTemplate, selectedTemplate, success, error, t]
  );

  const handleTemplateDuplicate = useCallback(
    async (template: Template) => {
      try {
        await duplicateTemplate.mutateAsync({
          templateId: template.id,
          name: t("dashboard.copyName", { name: template.name }),
        });
        success({ description: t("dashboard.toast.duplicateSuccess") });
      } catch {
        error({ description: t("dashboard.toast.duplicateError") });
      }
    },
    [duplicateTemplate, success, error, t]
  );

  const handleEditorCancel = useCallback(() => {
    setSelectedTemplate(null);
    setActiveTab("library");
  }, []);

  const topPerforming = useMemo(
    () =>
      templates.slice(0, 5).map((t) => ({
        templateId: t.id,
        templateName: t.name,
        views: 0,
        uses: 0,
        conversionRate: 0,
      })),
    [templates]
  );

  // TODO: wire real template analytics data from API
  const templateAnalytics = {
    topPerforming,
    recentActivity: [
      {
        action: t("dashboard.activity.templateCreated"),
        template: "Product Launch",
        time: t("dashboard.activity.hoursAgo", { count: 2 }),
      },
      {
        action: t("dashboard.activity.abTestStarted"),
        template: "Newsletter",
        time: t("dashboard.activity.hoursAgo", { count: 4 }),
      },
      {
        action: t("dashboard.activity.templateUsed"),
        template: "Social Media Post",
        time: t("dashboard.activity.hoursAgo", { count: 6 }),
      },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  {t("dashboard.stats.totalTemplates")}
                </p>
                <p className="text-2xl font-bold">{templateStats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Zap className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  {t("dashboard.stats.activeTemplates")}
                </p>
                <p className="text-2xl font-bold">{templateStats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <TestTube className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  {t("dashboard.stats.runningAbTests")}
                </p>
                <p className="text-2xl font-bold">{abTestStats.running}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Target className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  {t("dashboard.stats.categories")}
                </p>
                <p className="text-2xl font-bold">{templateStats.categories}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "library" | "editor" | "ab-testing" | "versions" | "analytics")
        }
      >
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="library" className="flex items-center space-x-2">
            <FileText className="h-4 w-4" />
            <span>{t("dashboard.tabs.library")}</span>
          </TabsTrigger>
          <TabsTrigger value="editor" className="flex items-center space-x-2">
            <Lightbulb className="h-4 w-4" />
            <span>{t("dashboard.tabs.editor")}</span>
          </TabsTrigger>
          <TabsTrigger value="ab-testing" className="flex items-center space-x-2">
            <TestTube className="h-4 w-4" />
            <span>{t("dashboard.tabs.abTesting")}</span>
          </TabsTrigger>
          <TabsTrigger value="versions" className="flex items-center space-x-2">
            <GitBranch className="h-4 w-4" />
            <span>{t("dashboard.tabs.versions")}</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center space-x-2">
            <BarChart3 className="h-4 w-4" />
            <span>{t("dashboard.tabs.analytics")}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t("dashboard.library.title")}</h2>
              <p className="text-gray-600">{t("dashboard.library.subtitle")}</p>
            </div>
            <Button onClick={handleTemplateCreate} className="flex items-center space-x-1">
              <Plus className="h-4 w-4" />
              <span>{t("dashboard.library.newTemplate")}</span>
            </Button>
          </div>

          <TemplateLibrary
            templates={templates}
            onTemplateSelect={handleTemplateSelect}
            onTemplateEdit={handleTemplateEdit}
            onTemplateDelete={handleTemplateDelete}
            onTemplateDuplicate={handleTemplateDuplicate}
            showAnalytics={true}
            allowEdit={true}
            allowDelete={true}
          />
        </TabsContent>

        <TabsContent value="editor" className="space-y-4">
          <TemplateEditor
            {...(selectedTemplate && { template: selectedTemplate })}
            onSave={handleTemplateSave}
            onCancel={handleEditorCancel}
            availablePlatforms={["twitter", "linkedin", "instagram", "facebook", "tiktok"]}
          />
        </TabsContent>

        <TabsContent value="ab-testing" className="space-y-4">
          <ABTestManager
            templates={templates}
            tests={abTests}
            onTestCreate={async (test) => {
              await createTest.mutateAsync(test);
            }}
            onTestUpdate={async (test) => {
              await updateTest.mutateAsync(test);
            }}
            onTestDelete={async (testId) => {
              await deleteTest.mutateAsync(testId);
            }}
            onTestStart={async (testId) => {
              await startTest.mutateAsync(testId);
            }}
            onTestStop={async (testId) => {
              await stopTest.mutateAsync(testId);
            }}
            allowManagement={true}
          />
        </TabsContent>

        <TabsContent value="versions" className="space-y-4">
          {selectedTemplate ? (
            <TemplateVersionControl
              template={selectedTemplate}
              versions={versions}
              onVersionCreate={async (version) => {
                await createVersion.mutateAsync(version);
              }}
              onVersionRestore={async (version) => {
                await restoreVersion.mutateAsync(version.id);
              }}
              onVersionDelete={async (versionId) => {
                await deleteVersion.mutateAsync(versionId);
              }}
              allowVersioning={true}
              allowBranching={false}
            />
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <GitBranch className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {t("dashboard.versions.emptyTitle")}
                </h3>
                <p className="text-gray-600 mb-4">{t("dashboard.versions.emptyDescription")}</p>
                <Button onClick={() => setActiveTab("library")} variant="outline">
                  {t("dashboard.versions.browseTemplates")}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Performing Templates */}
            <Card>
              <CardHeader>
                <CardTitle>{t("dashboard.analytics.topPerformingTitle")}</CardTitle>
                <CardDescription>
                  {t("dashboard.analytics.topPerformingDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {templateAnalytics.topPerforming.map((template, index) => (
                    <div key={template.templateId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center justify-center w-6 h-6 bg-blue-100 rounded-full text-xs font-medium text-blue-600">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{template.templateName}</p>
                          <p className="text-xs text-gray-600">
                            {t("dashboard.analytics.views", { count: template.views })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">
                          {t("dashboard.analytics.uses", { count: template.uses })}
                        </p>
                        <p className="text-xs text-gray-600">
                          {t("dashboard.analytics.rate", {
                            rate: (template.conversionRate * 100).toFixed(1),
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>{t("dashboard.analytics.recentActivityTitle")}</CardTitle>
                <CardDescription>
                  {t("dashboard.analytics.recentActivityDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {templateAnalytics.recentActivity.map((activity, index) => (
                    <div key={index} className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{activity.action}</p>
                        <p className="text-xs text-gray-600">{activity.template}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {activity.time}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Usage Statistics */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("dashboard.analytics.engineStatsTitle")}</CardTitle>
                <CardDescription>{t("dashboard.analytics.engineStatsDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{templateStats.total}</p>
                    <p className="text-sm text-gray-600">{t("dashboard.stats.totalTemplates")}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{abTestStats.running}</p>
                    <p className="text-sm text-gray-600">
                      {t("dashboard.analytics.activeAbTests")}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">
                      {templateEngine.getRegisteredHelpers().length}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t("dashboard.analytics.helperFunctions")}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-orange-600">
                      {versions.filter((v) => v.isActive).length}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t("dashboard.analytics.activeVersions")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
