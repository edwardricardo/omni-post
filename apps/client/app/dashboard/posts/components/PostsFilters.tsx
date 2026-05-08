/**
 * @file PostsFilters.tsx
 * @description Search field + status dropdown + view-mode picker +
 *              refresh button row above the posts list. View mode is
 *              `grid` / `list` / `virtual`; the dispatcher in the page
 *              switches the renderer based on it.
 * @component PostsFilters
 * @layer infrastructure
 */

import { Filter, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@packages/ui";

export type PostStatusFilter = "ALL" | "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
export type PostViewMode = "grid" | "list" | "virtual";

interface PostsFiltersProps {
  searchTerm: string;
  statusFilter: PostStatusFilter;
  viewMode: PostViewMode;
  isLoading: boolean;
  visibleCount: number;
  onSearchChange: (term: string) => void;
  onStatusChange: (status: PostStatusFilter) => void;
  onViewModeChange: (mode: PostViewMode) => void;
  onRefresh: () => void;
}

const STATUS_OPTIONS: PostStatusFilter[] = ["ALL", "DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"];

export function PostsFilters({
  searchTerm,
  statusFilter,
  viewMode,
  isLoading,
  visibleCount,
  onSearchChange,
  onStatusChange,
  onViewModeChange,
  onRefresh,
}: PostsFiltersProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
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
                {visibleCount} results
              </Badge>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                Status: {statusFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onStatusChange("ALL")}>All Posts</DropdownMenuItem>
              <DropdownMenuSeparator />
              {STATUS_OPTIONS.filter((opt) => opt !== "ALL").map((option) => (
                <DropdownMenuItem key={option} onClick={() => onStatusChange(option)}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </DropdownMenuItem>
              ))}
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
      </CardContent>
    </Card>
  );
}
