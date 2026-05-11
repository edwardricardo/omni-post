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

const SORT_OPTIONS: { field: PostSortField; label: string }[] = [
  { field: "createdAt", label: "Created" },
  { field: "updatedAt", label: "Updated" },
  { field: "scheduledAt", label: "Scheduled for" },
  { field: "publishedAt", label: "Published at" },
  { field: "status", label: "Status" },
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
  const tagsInputId = useId();
  const statusButtonLabel =
    selectedStatuses.size === 0 ? "Status: All" : `Status: ${selectedStatuses.size} selected`;
  const sortLabel = SORT_OPTIONS.find((o) => o.field === sortBy)?.label ?? sortBy;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* Row 1 — Search + status + sort + view + refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search posts..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
            {searchTerm && (
              <Badge
                variant="secondary"
                className="absolute right-3 top-1/2 transform -translate-y-1/2"
              >
                {visibleCount} visible
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
                <span className="text-blue-600">Clear all</span>
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
                    <span>
                      {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Sort: {sortLabel} {sortDirection === "asc" ? "↑" : "↓"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.field} onClick={() => onSortByChange(opt.field)}>
                  {opt.label}
                  {sortBy === opt.field && <span className="ml-2 text-blue-600">✓</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
              >
                {sortDirection === "asc" ? "Descending ↓" : "Ascending ↑"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                View: {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onViewModeChange("grid")}>
                Grid View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewModeChange("list")}>
                List View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewModeChange("virtual")}>
                Virtual Scroll
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
            Refresh
          </Button>
        </div>

        {/* Row 2 — Tag CSV input */}
        <div className="flex items-center gap-3">
          <label htmlFor={tagsInputId} className="text-sm text-muted-foreground whitespace-nowrap">
            Tags (CSV):
          </label>
          <Input
            id={tagsInputId}
            placeholder="e.g. launch,promo (any-match)"
            value={tagsInput}
            onChange={(e) => onTagsInputChange(e.target.value)}
            className="max-w-md"
          />
        </div>
      </CardContent>
    </Card>
  );
}
