/**
 * @file PostsBulkActionsBar.tsx
 * @description Sticky bar that appears when one or more posts are selected
 *              in the list. Exposes Duplicate / Archive / Delete bulk
 *              actions plus a "Clear selection" affordance. The actual
 *              mutations are owned by the page; this component is purely
 *              presentational.
 * @component PostsBulkActionsBar
 * @layer infrastructure
 */

import { Button } from "@packages/ui";
import { Copy, Archive, Trash2, X } from "lucide-react";

interface PostsBulkActionsBarProps {
  /** Count of selected posts. The bar hides itself when zero. */
  selectedCount: number;
  /** Disable all action buttons (e.g. while a mutation is in flight). */
  isPending: boolean;
  onClear: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function PostsBulkActionsBar({
  selectedCount,
  isPending,
  onClear,
  onDuplicate,
  onArchive,
  onDelete,
}: PostsBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${selectedCount} selected posts`}
      className="sticky top-4 z-20 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-blue-900">
          {selectedCount} {selectedCount === 1 ? "post" : "posts"} selected
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={onDuplicate}
        >
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onArchive}>
          <Archive className="mr-2 h-4 w-4" />
          Archive
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={onDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}
