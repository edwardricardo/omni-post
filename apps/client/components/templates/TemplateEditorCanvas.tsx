"use client";

/**
 * @file TemplateEditorCanvas.tsx
 * @description Main editing area for the TemplateEditor, handling the editor tabs (editor,
 * preview, variables, docs), editor mode switching, and content editing via textarea,
 * Monaco, or TipTap.
 * @component TemplateEditorCanvas
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Label } from "@packages/ui";
import { Textarea } from "@packages/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@packages/ui";
import { Separator, Alert, AlertDescription } from "@packages/ui";
import { Switch } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import {
  Eye,
  Code,
  Play,
  AlertCircle,
  CheckCircle,
  Info,
  Copy,
  Wand2,
  BookOpen,
  Zap,
} from "lucide-react";
import { VariableInserter } from "./VariableInserter.js";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const TipTapEditor = dynamic(() => import("./TipTapEditor.js"), { ssr: false });
import type { EditorTab, TemplateEditorCanvasProps } from "./templateEditorTypes.js";

export function TemplateEditorCanvas({
  formData,
  activeTab,
  editorMode,
  autoPreview,
  extractedVariables,
  compilationResult,
  previewContext,
  documentation,
  onContentChange,
  onMonacoContentChange,
  onVariableInsert,
  onPreview,
  onGenerateSampleContext,
  onCopyToClipboard,
  onTabChange,
  onEditorModeChange,
  onAutoPreviewChange,
  onPreviewContextChange,
  convertPlainTextToHtml,
}: TemplateEditorCanvasProps) {
  const t = useTranslations("templates.components.editor");
  const renderCompilationResult = () => {
    if (!compilationResult) return null;

    return (
      <div className="space-y-4">
        {compilationResult.success ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-700">{t("compiledSuccess")}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onCopyToClipboard}
                className="flex items-center space-x-1"
              >
                <Copy className="h-3 w-3" />
                <span>{t("copy")}</span>
              </Button>
            </div>

            <Card>
              <CardContent className="p-4">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                  {compilationResult.content}
                </pre>
              </CardContent>
            </Card>

            {compilationResult.warnings && compilationResult.warnings.length > 0 && (
              <Alert>
                <AlertCircle aria-hidden="true" className="h-4 w-4" />
                <AlertDescription>
                  <strong>{t("warnings")}</strong>
                  <ul className="mt-1 list-disc list-inside">
                    {compilationResult.warnings.map((warning, index) => (
                      <li key={index} className="text-sm">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" className="h-4 w-4" />
            <AlertDescription>
              <strong>{t("compilationFailed")}</strong>
              <ul className="mt-1 list-disc list-inside">
                {compilationResult.errors?.map((err, index) => (
                  <li key={index} className="text-sm">
                    {err}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("contentTitle")}</CardTitle>
            <CardDescription>{t("contentDescription")}</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              <Switch
                id="auto-preview"
                checked={autoPreview}
                onCheckedChange={onAutoPreviewChange}
              />
              <Label htmlFor="auto-preview" className="text-sm">
                {t("autoPreview")}
              </Label>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center space-x-1">
              <Label className="text-sm">{t("editorLabel")}</Label>
              <Select
                value={editorMode}
                onValueChange={(value) =>
                  onEditorModeChange(value as "textarea" | "monaco" | "tiptap")
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="textarea">{t("editorModeBasic")}</SelectItem>
                  <SelectItem value="monaco">{t("editorModeCode")}</SelectItem>
                  <SelectItem value="tiptap">{t("editorModeRichText")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as EditorTab)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="editor" className="flex items-center space-x-1">
              <Code className="h-4 w-4" />
              <span>{t("tabEditor")}</span>
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center space-x-1">
              <Eye className="h-4 w-4" />
              <span>{t("tabPreview")}</span>
            </TabsTrigger>
            <TabsTrigger value="variables" className="flex items-center space-x-1">
              <Zap className="h-4 w-4" />
              <span>{t("tabVariables")}</span>
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex items-center space-x-1">
              <BookOpen className="h-4 w-4" />
              <span>{t("tabDocumentation")}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-3">
                {editorMode === "monaco" && (
                  <div className="border rounded-lg overflow-hidden">
                    <Editor
                      height="400px"
                      language="handlebars"
                      theme="vs-dark"
                      value={formData.content || ""}
                      onChange={onMonacoContentChange}
                      options={{
                        minimap: { enabled: false },
                        lineNumbers: "on",
                        wordWrap: "on",
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        fontSize: 14,
                        tabSize: 2,
                      }}
                    />
                  </div>
                )}

                {editorMode === "tiptap" && (
                  <TipTapEditor
                    content={convertPlainTextToHtml(formData.content || "")}
                    onChange={onContentChange}
                    placeholder={t("contentPlaceholder")}
                    onVariableInsert={onVariableInsert}
                    className="min-h-[400px]"
                  />
                )}

                {editorMode === "textarea" && (
                  <Textarea
                    value={formData.content || ""}
                    onChange={(e) => onContentChange(e.target.value)}
                    placeholder={t("contentPlaceholder")}
                    className="min-h-[400px] font-mono text-sm"
                    style={{ resize: "vertical" }}
                  />
                )}
              </div>

              <div className="lg:col-span-1">
                <VariableInserter
                  onVariableInsert={onVariableInsert}
                  availableVariables={extractedVariables}
                  context={previewContext}
                  onContextChange={onPreviewContextChange}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <span>{t("variablesCount", { count: extractedVariables.length })}</span>
                <span>{t("charactersCount", { count: formData.content?.length || 0 })}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onPreview}
                className="flex items-center space-x-1"
              >
                <Play className="h-3 w-3" />
                <span>{t("preview")}</span>
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">{t("previewHeading")}</h3>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onGenerateSampleContext}
                  className="flex items-center space-x-1"
                >
                  <Wand2 className="h-3 w-3" />
                  <span>{t("generateSampleData")}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPreview}
                  className="flex items-center space-x-1"
                >
                  <Play className="h-3 w-3" />
                  <span>{t("refreshPreview")}</span>
                </Button>
              </div>
            </div>
            {renderCompilationResult()}
          </TabsContent>

          <TabsContent value="variables" className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-4">{t("variablesHeading")}</h3>
              {extractedVariables.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid gap-4">
                    {extractedVariables.map((variable, index) => (
                      <Card key={index}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <Badge variant="outline">{variable.name}</Badge>
                              <Badge variant="secondary">{variable.type}</Badge>
                              {variable.required && (
                                <Badge variant="destructive" className="text-xs">
                                  {t("required")}
                                </Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onVariableInsert(variable.name)}
                            >
                              {t("insert")}
                            </Button>
                          </div>
                          {variable.description && (
                            <p className="text-sm text-muted-foreground mt-2">
                              {variable.description}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <Alert>
                  <Info aria-hidden="true" className="h-4 w-4" />
                  <AlertDescription>
                    {t.rich("noVariablesDetected", {
                      code: (chunks) => <code>{chunks}</code>,
                    })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>

          <TabsContent value="docs" className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-4">{t("documentationHeading")}</h3>
              {documentation && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t("availableHelpers")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {documentation.helpers.map((helper) => (
                          <Badge key={helper} variant="outline" className="justify-center">
                            {helper}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t("variableExamples")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {documentation.examples.map((example) => (
                          <div
                            key={example.variable}
                            className="flex items-center justify-between p-2 border rounded-sm"
                          >
                            <code className="text-sm">{`{{${example.variable}}}`}</code>
                            <Badge variant="secondary" className="text-xs">
                              {example.example}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t("syntaxGuide")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="font-medium">{t("syntaxBasicVariables")}</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm">
                          {`{{username}} - ${t("syntaxBasicVariablesExample")}`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">{t("syntaxConditionals")}</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm whitespace-pre">
                          {`{{#if premium}}\n  ${t("syntaxConditionalsPremium")}\n{{else}}\n  ${t("syntaxConditionalsStandard")}\n{{/if}}`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">{t("syntaxLoops")}</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm whitespace-pre">
                          {`{{#each hashtags}}\n  #{{this}}\n{{/each}}`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">{t("syntaxHelpers")}</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm">
                          {`{{formatDate date "MMM dd, yyyy"}} - ${t("syntaxHelpersExample")}`}
                        </code>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
