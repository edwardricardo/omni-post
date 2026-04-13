"use client";

/**
 * @file VariableInserter.tsx
 * @component VariableInserter
 * @description Side panel for browsing, searching, and inserting Handlebars template
 * variables grouped by category, with live context value editing and copy support.
 */

import React, { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Input, ScrollArea, Separator } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@packages/ui";
import {
  Plus,
  Search,
  Hash,
  Calendar,
  User,
  Star,
  Code,
  Type,
  Clock,
  Zap,
  X,
  Copy,
} from "lucide-react";
import { TemplateVariable, TemplateContext } from "@/lib/templates/templateEngine";
import { useToast } from "@packages/ui";

interface VariableInserterProps {
  onVariableInsert: (variable: string) => void;
  availableVariables: TemplateVariable[];
  context: TemplateContext;
  onContextChange: (context: TemplateContext) => void;
}

interface VariableGroup {
  name: string;
  icon: React.ReactNode;
  variables: string[];
  description: string;
}

interface HelperInfo {
  name: string;
  syntax: string;
  description: string;
  example: string;
  category: string;
}

const COMMON_VARIABLES: VariableGroup[] = [
  {
    name: "User & Profile",
    icon: <User className="h-4 w-4" />,
    variables: ["username", "firstName", "lastName", "email", "avatar", "bio"],
    description: "User profile information",
  },
  {
    name: "Date & Time",
    icon: <Calendar className="h-4 w-4" />,
    variables: ["date", "time", "currentYear", "currentMonth", "currentDay", "timestamp"],
    description: "Date and time variables",
  },
  {
    name: "Social Media",
    icon: <Hash className="h-4 w-4" />,
    variables: ["hashtags", "mentions", "platforms", "followersCount", "likesCount"],
    description: "Social media related variables",
  },
  {
    name: "Business",
    icon: <Star className="h-4 w-4" />,
    variables: ["companyName", "productName", "price", "discount", "offer", "revenue"],
    description: "Business and product variables",
  },
  {
    name: "Content",
    icon: <Type className="h-4 w-4" />,
    variables: ["title", "description", "content", "summary", "category", "tags"],
    description: "Content related variables",
  },
  {
    name: "Events",
    icon: <Clock className="h-4 w-4" />,
    variables: ["eventName", "eventDate", "eventTime", "location", "speakers", "agenda"],
    description: "Event information variables",
  },
];

const HANDLEBARS_HELPERS: HelperInfo[] = [
  {
    name: "if",
    syntax: "{{#if condition}}...{{/if}}",
    description: "Conditional block - renders content if condition is truthy",
    example: "{{#if premium}}Premium content{{/if}}",
    category: "Conditionals",
  },
  {
    name: "unless",
    syntax: "{{#unless condition}}...{{/unless}}",
    description: "Inverse conditional - renders content if condition is falsy",
    example: "{{#unless premium}}Free content{{/unless}}",
    category: "Conditionals",
  },
  {
    name: "each",
    syntax: "{{#each array}}...{{/each}}",
    description: "Loop through an array",
    example: "{{#each hashtags}}#{{this}} {{/each}}",
    category: "Loops",
  },
  {
    name: "with",
    syntax: "{{#with object}}...{{/with}}",
    description: "Change context to an object",
    example: "{{#with user}}{{firstName}} {{lastName}}{{/with}}",
    category: "Context",
  },
  {
    name: "formatDate",
    syntax: '{{formatDate date "format"}}',
    description: "Format a date using date-fns format strings",
    example: '{{formatDate date "MMM dd, yyyy"}}',
    category: "Formatting",
  },
  {
    name: "uppercase",
    syntax: "{{uppercase string}}",
    description: "Convert string to uppercase",
    example: "{{uppercase productName}}",
    category: "Formatting",
  },
  {
    name: "lowercase",
    syntax: "{{lowercase string}}",
    description: "Convert string to lowercase",
    example: "{{lowercase email}}",
    category: "Formatting",
  },
  {
    name: "capitalize",
    syntax: "{{capitalize string}}",
    description: "Capitalize first letter of string",
    example: "{{capitalize firstName}}",
    category: "Formatting",
  },
  {
    name: "join",
    syntax: '{{join array "separator"}}',
    description: "Join array elements with separator",
    example: '{{join hashtags ", "}}',
    category: "Arrays",
  },
  {
    name: "length",
    syntax: "{{length array}}",
    description: "Get length of array or string",
    example: "{{length hashtags}} tags",
    category: "Arrays",
  },
  {
    name: "hashtag",
    syntax: "{{hashtag tag}}",
    description: "Add # prefix to tag if not present",
    example: '{{hashtag "productivity"}}',
    category: "Social",
  },
  {
    name: "link",
    syntax: '{{link url "text"}}',
    description: "Create a markdown link",
    example: '{{link website "Visit our site"}}',
    category: "Formatting",
  },
  {
    name: "eq",
    syntax: "{{#if (eq a b)}}...{{/if}}",
    description: "Check if two values are equal",
    example: '{{#if (eq platform "twitter")}}Tweet content{{/if}}',
    category: "Conditionals",
  },
  {
    name: "random",
    syntax: '{{random "option1" "option2" "option3"}}',
    description: "Randomly select one of the provided options",
    example: '{{random "Great!" "Awesome!" "Amazing!"}}',
    category: "Utility",
  },
];

export function VariableInserter({
  onVariableInsert,
  availableVariables,
  context,
  onContextChange,
}: VariableInserterProps) {
  const { success } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"variables" | "helpers" | "context">("variables");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [newContextKey, setNewContextKey] = useState("");
  const [newContextValue, setNewContextValue] = useState("");

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

  const helperCategories = useMemo(() => {
    const categories = [...new Set(HANDLEBARS_HELPERS.map((h) => h.category))];
    return ["all", ...categories];
  }, []);

  const handleInsertVariable = useCallback(
    (variableName: string) => {
      onVariableInsert(variableName);
      success({ description: `Inserted variable: {{${variableName}}}` });
    },
    [onVariableInsert, success]
  );

  const handleInsertHelper = useCallback(
    (helper: HelperInfo) => {
      onVariableInsert(helper.syntax.replace("{{", "").replace("}}", ""));
      success({ description: `Inserted helper: ${helper.name}` });
    },
    [onVariableInsert, success]
  );

  const handleCopyHelper = useCallback(
    async (syntax: string) => {
      try {
        await navigator.clipboard.writeText(syntax);
        success({ description: "Helper syntax copied to clipboard!" });
      } catch {
        // Fallback for browsers that don't support clipboard API
      }
    },
    [success]
  );

  const handleAddContextVariable = useCallback(() => {
    if (!newContextKey.trim() || !newContextValue.trim()) return;

    const newContext = {
      ...context,
      [newContextKey]: newContextValue,
    };

    onContextChange(newContext);
    setNewContextKey("");
    setNewContextValue("");
    success({ description: `Added context variable: ${newContextKey}` });
  }, [context, newContextKey, newContextValue, onContextChange, success]);

  const handleRemoveContextVariable = useCallback(
    (key: string) => {
      const newContext = { ...context };
      delete newContext[key];
      onContextChange(newContext);
      success({ description: `Removed context variable: ${key}` });
    },
    [context, onContextChange, success]
  );

  const handleUpdateContextVariable = useCallback(
    (key: string, value: string) => {
      const newContext = {
        ...context,
        [key]: value,
      };
      onContextChange(newContext);
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
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search variables or helpers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Tabs */}
          <div className="flex space-x-1">
            {["variables", "helpers", "context"].map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab(tab as any)}
                className="flex-1 text-xs"
              >
                {tab === "variables" && <Zap className="h-3 w-3 mr-1" />}
                {tab === "helpers" && <Code className="h-3 w-3 mr-1" />}
                {tab === "context" && <Type className="h-3 w-3 mr-1" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Button>
            ))}
          </div>

          <ScrollArea className="h-96">
            {activeTab === "variables" && (
              <div className="space-y-4">
                {/* Detected Variables */}
                {availableVariables.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      Detected Variables
                    </h4>
                    <div className="space-y-1">
                      {availableVariables.map((variable, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          onClick={() => handleInsertVariable(variable.name)}
                          className="w-full justify-between text-xs"
                        >
                          <span>{`{{${variable.name}}}`}</span>
                          <Badge variant="secondary" className="text-xs">
                            {variable.type}
                          </Badge>
                        </Button>
                      ))}
                    </div>
                    <Separator />
                  </div>
                )}

                {/* Common Variables */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Common Variables</h4>
                  {filteredVariableGroups.map((group, groupIndex) => (
                    <div key={groupIndex} className="space-y-2">
                      <div className="flex items-center space-x-2">
                        {group.icon}
                        <span className="text-xs font-medium">{group.name}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {group.variables.map((variable, varIndex) => (
                          <Button
                            key={varIndex}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleInsertVariable(variable)}
                            className="justify-start text-xs font-mono"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {variable}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "helpers" && (
              <div className="space-y-4">
                {/* Category Filter */}
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {helperCategories.map((category) => (
                      <SelectItem key={category} value={category} className="text-xs">
                        {category === "all" ? "All Categories" : category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Helpers List */}
                <div className="space-y-2">
                  {filteredHelpers.map((helper, index) => (
                    <Card key={index} className="p-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {helper.name}
                          </Badge>
                          <div className="flex space-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopyHelper(helper.syntax)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Copy syntax</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleInsertHelper(helper)}
                                  className="h-6 w-6 p-0"
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Insert helper</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{helper.description}</p>
                        <code className="block text-xs bg-muted p-2 rounded-sm">
                          {helper.example}
                        </code>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "context" && (
              <div className="space-y-4">
                {/* Add New Context Variable */}
                <Card className="p-3">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Add Context Variable</h4>
                    <div className="flex space-x-2">
                      <Input
                        placeholder="Variable name"
                        value={newContextKey}
                        onChange={(e) => setNewContextKey(e.target.value)}
                        className="text-xs"
                      />
                      <Input
                        placeholder="Value"
                        value={newContextValue}
                        onChange={(e) => setNewContextValue(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleAddContextVariable}
                      disabled={!newContextKey.trim() || !newContextValue.trim()}
                      className="w-full text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Variable
                    </Button>
                  </div>
                </Card>

                {/* Current Context Variables */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Current Context</h4>
                  {Object.entries(context).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(context).map(([key, value]) => (
                        <Card key={key} className="p-2">
                          <div className="flex items-center justify-between space-x-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium font-mono truncate">{key}</div>
                              <Input
                                value={String(value || "")}
                                onChange={(e) => handleUpdateContextVariable(key, e.target.value)}
                                className="text-xs mt-1"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveContextVariable(key)}
                              className="h-6 w-6 p-0 shrink-0"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No context variables set. Add some above to see them here.
                    </p>
                  )}
                </div>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
