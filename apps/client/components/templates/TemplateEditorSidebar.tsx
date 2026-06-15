"use client";

/**
 * @file TemplateEditorSidebar.tsx
 * @component TemplateEditorSidebar
 * @description Settings/properties panel for the TemplateEditor. Renders the template
 * name, description, category selector, and supported platforms picker.
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("templates.components.editor");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sidebarTitle")}</CardTitle>
        <CardDescription>{t("sidebarDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("nameLabel")}</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) => onFormDataChange((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">{t("categoryLabel")}</Label>
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
          <Label htmlFor="description">{t("descriptionLabel")}</Label>
          <Input
            id="description"
            value={formData.description || ""}
            onChange={(e) => onFormDataChange((prev) => ({ ...prev, description: e.target.value }))}
            placeholder={t("descriptionPlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("supportedPlatforms")}</Label>
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
