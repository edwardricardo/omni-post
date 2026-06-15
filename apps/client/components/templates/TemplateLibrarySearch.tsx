"use client";

/**
 * @file TemplateLibrarySearch.tsx
 * @description Search bar and filter controls for the TemplateLibrary, including category,
 * platform, sort, view mode selectors, and clear-filters button.
 * @component TemplateLibrarySearch
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import { Search, Grid, List } from "lucide-react";
import type { TemplateLibrarySearchProps, SortBy } from "./templateLibraryTypes.js";

export function TemplateLibrarySearch({
  searchTerm,
  filters,
  sortBy,
  viewMode,
  categories,
  platforms,
  showAnalytics,
  onSearchChange,
  onFiltersChange,
  onSortByChange,
  onViewModeChange,
  onResetFilters,
}: TemplateLibrarySearchProps) {
  const t = useTranslations("templates.components.library");
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("search.placeholder")}
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            <Select
              value={filters.category}
              onValueChange={(value) => onFiltersChange((prev) => ({ ...prev, category: value }))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("search.category")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category === "all" ? t("search.allCategories") : category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.platform}
              onValueChange={(value) => onFiltersChange((prev) => ({ ...prev, platform: value }))}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("search.platform")} />
              </SelectTrigger>
              <SelectContent>
                {platforms.map((platform) => (
                  <SelectItem key={platform} value={platform}>
                    {platform === "all" ? t("search.allPlatforms") : platform.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value) => onSortByChange(value as SortBy)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("search.sortBy")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">{t("search.sortUpdated")}</SelectItem>
                <SelectItem value="created">{t("search.sortCreated")}</SelectItem>
                <SelectItem value="name">{t("search.sortName")}</SelectItem>
                <SelectItem value="category">{t("search.sortCategory")}</SelectItem>
                {showAnalytics && (
                  <SelectItem value="popularity">{t("search.sortPopularity")}</SelectItem>
                )}
              </SelectContent>
            </Select>

            <div className="flex items-center space-x-2">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => onViewModeChange("grid")}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => onViewModeChange("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={onResetFilters}>
              {t("search.clearFilters")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
