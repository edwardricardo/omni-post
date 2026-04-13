"use client";

/**
 * @file TemplateEditorSidebar.tsx
 * @component TemplateEditorSidebar
 * @description Settings/properties panel for the TemplateEditor. Renders the template
 * name, description, category selector, and supported platforms picker.
 */

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import type { TemplateEditorSidebarProps } from "./templateEditorTypes";

export function TemplateEditorSidebar({
  formData,
  availablePlatforms,
  categories,
  onFormDataChange,
}: TemplateEditorSidebarProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Template Information</CardTitle>
        <CardDescription>Basic template details and configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name *</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) => onFormDataChange((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter template name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={formData.category || "announcement"}
              onValueChange={(value) => onFormDataChange((prev) => ({ ...prev, category: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <div>
                      <div className="font-medium">{category.name}</div>
                      <div className="text-xs text-muted-foreground">{category.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={formData.description || ""}
            onChange={(e) => onFormDataChange((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Brief description of this template"
          />
        </div>

        <div className="space-y-2">
          <Label>Supported Platforms</Label>
          <div className="flex flex-wrap gap-2">
            {availablePlatforms.map((platform) => (
              <Button
                key={platform}
                variant={formData.platforms?.includes(platform) ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  const platforms = formData.platforms || [];
                  const newPlatforms = platforms.includes(platform)
                    ? platforms.filter((p) => p !== platform)
                    : [...platforms, platform];
                  onFormDataChange((prev) => ({ ...prev, platforms: newPlatforms }));
                }}
              >
                {platform.charAt(0).toUpperCase() + platform.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
