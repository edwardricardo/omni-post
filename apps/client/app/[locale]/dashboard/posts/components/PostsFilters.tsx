/**
 * @file PostsFilters.tsx
 * @description Filter + sort + view-mode controls above the posts list.
 *              Supports multi-select status, tag CSV input, sort by field
 *              + direction, three view modes (grid/list/virtual), and a
 *              refresh button. The page owns all filter state and feeds
 *              it back through the change callbacks.
 * @component PostsFilters
 * @layer infrastructure
 */

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Filter, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@packages/ui";
import type { PostSortField, PostStatus } from "@/lib/api/clients/postsClient";

export type PostStatusFilter = "ALL" | PostStatus;
export type PostViewMode = "grid" | "list" | "virtual";

const STATUS_OPTIONS: PostStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
];

const SORT_FIELDS: PostSortField[] = [
  "createdAt",
  "updatedAt",
  "scheduledAt",
  "publishedAt",
  "status",
];

interface PostsFiltersProps {
  searchTerm: string;
  selectedStatuses: ReadonlySet<PostStatus>;
  tagsInput: string;
  sortBy: PostSortField;
  sortDirection: "asc" | "desc";
  viewMode: PostViewMode;
  isLoading: boolean;
  visibleCount: number;
  onSearchChange: (term: string) => void;
  onStatusToggle: (status: PostStatus) => void;
  onClearStatuses: () => void;
  onTagsInputChange: (raw: string) => void;
  onSortByChange: (field: PostSortField) => void;
  onSortDirectionChange: (direction: "asc" | "desc") => void;
  onViewModeChange: (mode: PostViewMode) => void;
  onRefresh: () => void;
}

export function PostsFilters({
  searchTerm,
  selectedStatuses,
  tagsInput,
  sortBy,
  sortDirection,
  viewMode,
  isLoading,
  visibleCount,
  onSearchChange,
  onStatusToggle,
  onClearStatuses,
  onTagsInputChange,
  onSortByChange,
  onSortDirectionChange,
  onViewModeChange,
  onRefresh,
}: PostsFiltersProps) {
  const t = useTranslations("posts");
  const tagsInputId = useId();
  const statusButtonLabel =
    selectedStatuses.size === 0
      ? t("filters.statusAll")
      : t("filters.statusSelected", { count: selectedStatuses.size });
  const sortLabel = t(`sort.${sortBy}`);

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* Row 1 — Search + status + sort + view + refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("filters.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
            {searchTerm && (
              <Badge
                variant="secondary"
                className="absolute right-3 top-1/2 transform -translate-y-1/2"
              >
                {t("filters.visibleCount", { count: visibleCount })}
              </Badge>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                {statusButtonLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onClearStatuses();
                }}
              >
                <span className="text-blue-600">{t("filters.clearAll")}</span>
              </DropdownMenuItem>
              {STATUS_OPTIONS.map((status) => {
                const checked = selectedStatuses.has(status);
                return (
                  <DropdownMenuItem
                    key={status}
                    onSelect={(e) => {
                      e.preventDefault();
                      onStatusToggle(status);
                    }}
                    className="cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="mr-2 h-4 w-4 rounded border-gray-300"
                    />
                    <span>{t(`status.${status}`)}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {t("filters.sortLabel", { field: sortLabel })} {sortDirection === "asc" ? "↑" : "↓"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {SORT_FIELDS.map((field) => (
                <DropdownMenuItem key={field} onClick={() => onSortByChange(field)}>
                  {t(`sort.${field}`)}
                  {sortBy === field && <span className="ml-2 text-blue-600">✓</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
              >
                {sortDirection === "asc" ? t("filters.descending") : t("filters.ascending")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {t("filters.viewLabel", { mode: t(`view.${viewMode}`) })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onViewModeChange("grid")}>
                {t("view.grid")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewModeChange("list")}>
                {t("view.list")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewModeChange("virtual")}>
                {t("view.virtual")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
            {t("filters.refresh")}
          </Button>
        </div>

        {/* Row 2 — Tag CSV input */}
        <div className="flex items-center gap-3">
          <label htmlFor={tagsInputId} className="text-sm text-muted-foreground whitespace-nowrap">
            {t("filters.tagsLabel")}
          </label>
          <Input
            id={tagsInputId}
            placeholder={t("filters.tagsPlaceholder")}
            value={tagsInput}
            onChange={(e) => onTagsInputChange(e.target.value)}
            className="max-w-md"
          />
        </div>
      </CardContent>
    </Card>
  );
}
