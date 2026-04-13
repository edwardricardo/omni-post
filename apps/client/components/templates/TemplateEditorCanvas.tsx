"use client";

/**
 * @file TemplateEditorCanvas.tsx
 * @component TemplateEditorCanvas
 * @description Main editing area for the TemplateEditor, handling the editor tabs (editor,
 * preview, variables, docs), editor mode switching, and content editing via textarea,
 * Monaco, or TipTap.
 */

import React from "react";
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
import Editor from "@monaco-editor/react";
import { VariableInserter } from "./VariableInserter";
import TipTapEditor from "./TipTapEditor";
import type { TemplateEditorCanvasProps } from "./templateEditorTypes";

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
  const renderCompilationResult = () => {
    if (!compilationResult) return null;

    return (
      <div className="space-y-4">
        {compilationResult.success ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-700">
                  Template compiled successfully
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onCopyToClipboard}
                className="flex items-center space-x-1"
              >
                <Copy className="h-3 w-3" />
                <span>Copy</span>
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
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Warnings:</strong>
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
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Compilation failed:</strong>
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
            <CardTitle>Template Content</CardTitle>
            <CardDescription>Create your template using Handlebars syntax</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              <Switch
                id="auto-preview"
                checked={autoPreview}
                onCheckedChange={onAutoPreviewChange}
              />
              <Label htmlFor="auto-preview" className="text-sm">
                Auto Preview
              </Label>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center space-x-1">
              <Label className="text-sm">Editor:</Label>
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
                  <SelectItem value="textarea">Basic</SelectItem>
                  <SelectItem value="monaco">Code</SelectItem>
                  <SelectItem value="tiptap">Rich Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as any)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="editor" className="flex items-center space-x-1">
              <Code className="h-4 w-4" />
              <span>Editor</span>
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center space-x-1">
              <Eye className="h-4 w-4" />
              <span>Preview</span>
            </TabsTrigger>
            <TabsTrigger value="variables" className="flex items-center space-x-1">
              <Zap className="h-4 w-4" />
              <span>Variables</span>
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex items-center space-x-1">
              <BookOpen className="h-4 w-4" />
              <span>Documentation</span>
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
                    placeholder="Enter your template content using Handlebars syntax..."
                    onVariableInsert={onVariableInsert}
                    className="min-h-[400px]"
                  />
                )}

                {editorMode === "textarea" && (
                  <Textarea
                    value={formData.content || ""}
                    onChange={(e) => onContentChange(e.target.value)}
                    placeholder="Enter your template content using Handlebars syntax..."
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
                <span>Variables: {extractedVariables.length}</span>
                <span>Characters: {formData.content?.length || 0}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onPreview}
                className="flex items-center space-x-1"
              >
                <Play className="h-3 w-3" />
                <span>Preview</span>
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Template Preview</h3>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onGenerateSampleContext}
                  className="flex items-center space-x-1"
                >
                  <Wand2 className="h-3 w-3" />
                  <span>Generate Sample Data</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPreview}
                  className="flex items-center space-x-1"
                >
                  <Play className="h-3 w-3" />
                  <span>Refresh Preview</span>
                </Button>
              </div>
            </div>
            {renderCompilationResult()}
          </TabsContent>

          <TabsContent value="variables" className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-4">Template Variables</h3>
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
                                  Required
                                </Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onVariableInsert(variable.name)}
                            >
                              Insert
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
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    No variables detected in the template. Add variables using double curly braces:{" "}
                    <code>{`{{variableName}}`}</code>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>

          <TabsContent value="docs" className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-4">Template Documentation</h3>
              {documentation && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Available Helpers</CardTitle>
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
                      <CardTitle className="text-base">Variable Examples</CardTitle>
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
                      <CardTitle className="text-base">Syntax Guide</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="font-medium">Basic Variables</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm">
                          {`{{username}} - Simple variable insertion`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">Conditionals</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm whitespace-pre">
                          {`{{#if premium}}\n  Premium content here\n{{else}}\n  Standard content\n{{/if}}`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">Loops</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm whitespace-pre">
                          {`{{#each hashtags}}\n  #{{this}}\n{{/each}}`}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium">Helpers</h4>
                        <code className="block p-2 bg-muted rounded-sm text-sm">
                          {`{{formatDate date "MMM dd, yyyy"}} - Date formatting`}
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
