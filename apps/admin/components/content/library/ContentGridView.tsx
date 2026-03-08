"use client";

/**
 * @file ContentGridView.tsx
 * @description Grid layout container for the content library that renders a responsive
 * card grid of ContentGridItem components for the current page of content items.
 */

import React from "react";
import type { ContentItem } from "./types";
import { ContentGridItem } from "./ContentGridItem";

interface ContentGridViewProps {
  items: ContentItem[];
  selectedItems: string[];
  enableBulkActions: boolean;
  onItemSelect: (itemId: string) => void;
  onItemClick: (item: ContentItem) => void;
}

export function ContentGridView({
  items,
  selectedItems,
  enableBulkActions,
  onItemSelect,
  onItemClick,
}: ContentGridViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
      {items.map((item) => (
        <ContentGridItem
          key={item.id}
          item={item}
          isSelected={selectedItems.includes(item.id)}
          enableBulkActions={enableBulkActions}
          onSelect={onItemSelect}
          onItemClick={onItemClick}
        />
      ))}
    </div>
  );
}
