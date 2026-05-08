"use client";

/**
 * @file VariableInserter.tsx
 * @description Side panel for the template editor: browse, search, and
 *              insert Handlebars variables and helpers, plus a sandbox
 *              that lets the user define context values for the live
 *              preview. Composes three tab sub-components from
 *              `./variableInserter/`.
 * @component VariableInserter
 * @layer infrastructure
 */

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input, ScrollArea } from "@packages/ui";
import { TooltipProvider } from "@packages/ui";
import { toast } from "@packages/ui";
import { Code, Search, Type, Zap } from "lucide-react";
import type { TemplateContext, TemplateVariable } from "@/lib/templates/templateEngine";
import {
  COMMON_VARIABLES,
  ContextTab,
  HANDLEBARS_HELPERS,
  HELPER_CATEGORIES,
  HelpersTab,
  VariablesTab,
  type HelperInfo,
} from "./variableInserter";

interface VariableInserterProps {
  onVariableInsert: (variable: string) => void;
  availableVariables: TemplateVariable[];
  context: TemplateContext;
  onContextChange: (context: TemplateContext) => void;
}

type EditorTab = "variables" | "helpers" | "context";
const TAB_DEFS: ReadonlyArray<{ id: EditorTab; label: string; Icon: typeof Zap }> = [
  { id: "variables", label: "Variables", Icon: Zap },
  { id: "helpers", label: "Helpers", Icon: Code },
  { id: "context", label: "Context", Icon: Type },
];

export function VariableInserter({
  onVariableInsert,
  availableVariables,
  context,
  onContextChange,
}: VariableInserterProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTab>("variables");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredVariableGroups = useMemo(() => {
    if (!searchTerm) return COMMON_VARIABLES;
    return COMMON_VARIABLES.map((group) => ({
      ...group,
      variables: group.variables.filter((variable) =>
        variable.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    })).filter((group) => group.variables.length > 0);
  }, [searchTerm]);

  const filteredHelpers = useMemo(() => {
    let helpers = HANDLEBARS_HELPERS;
    if (selectedCategory !== "all") {
      helpers = helpers.filter((helper) => helper.category === selectedCategory);
    }
    if (searchTerm) {
      helpers = helpers.filter(
        (helper) =>
          helper.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          helper.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return helpers;
  }, [searchTerm, selectedCategory]);

  const handleInsertVariable = useCallback(
    (variableName: string) => {
      onVariableInsert(variableName);
      toast({ title: `Inserted variable: {{${variableName}}}` });
    },
    [onVariableInsert]
  );

  const handleInsertHelper = useCallback(
    (helper: HelperInfo) => {
      // Insert the helper's full syntax verbatim. The previous behaviour
      // — `replace("{{","").replace("}}","")` — only stripped the first
      // pair of braces, which corrupted block helpers like `{{#if}}…{{/if}}`
      // by leaving the closing tag with mismatched braces.
      onVariableInsert(helper.syntax);
      toast({ title: `Inserted helper: ${helper.name}` });
    },
    [onVariableInsert]
  );

  const handleCopyHelper = useCallback(async (syntax: string) => {
    try {
      await navigator.clipboard.writeText(syntax);
      toast({ title: "Helper syntax copied to clipboard!" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Clipboard not available";
      toast({ title: "Copy failed", description: message, variant: "destructive" });
    }
  }, []);

  const handleAddContextVariable = useCallback(
    (key: string, value: string) => {
      onContextChange({ ...context, [key]: value });
      toast({ title: `Added context variable: ${key}` });
    },
    [context, onContextChange]
  );

  const handleRemoveContextVariable = useCallback(
    (key: string) => {
      const next = { ...context };
      delete next[key];
      onContextChange(next);
      toast({ title: `Removed context variable: ${key}` });
    },
    [context, onContextChange]
  );

  const handleUpdateContextVariable = useCallback(
    (key: string, value: string) => {
      onContextChange({ ...context, [key]: value });
    },
    [context, onContextChange]
  );

  return (
    <TooltipProvider>
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Template Assistant</CardTitle>
          <CardDescription className="text-sm">
            Insert variables, helpers, and manage context
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search variables or helpers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="flex space-x-1">
            {TAB_DEFS.map(({ id, label, Icon }) => (
              <Button
                key={id}
                variant={activeTab === id ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab(id)}
                className="flex-1 text-xs"
              >
                <Icon className="h-3 w-3 mr-1" />
                {label}
              </Button>
            ))}
          </div>

          <ScrollArea className="h-96">
            {activeTab === "variables" && (
              <VariablesTab
                detectedVariables={availableVariables}
                filteredGroups={filteredVariableGroups}
                onInsertVariable={handleInsertVariable}
              />
            )}
            {activeTab === "helpers" && (
              <HelpersTab
                helpers={filteredHelpers}
                categories={HELPER_CATEGORIES}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                onCopyHelper={handleCopyHelper}
                onInsertHelper={handleInsertHelper}
              />
            )}
            {activeTab === "context" && (
              <ContextTab
                context={context}
                onAdd={handleAddContextVariable}
                onRemove={handleRemoveContextVariable}
                onUpdate={handleUpdateContextVariable}
              />
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
