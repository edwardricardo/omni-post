/**
 * @file QueueDetailsView.tsx
 * @description Side panel view that renders the QueueDetailCard for the currently selected
 * queue item, or a placeholder prompt when no item is selected.
 */

import React from "react";
import type { QueueItem } from "./types";
import { QueueDetailCard } from "./QueueDetailCard";

interface QueueDetailsViewProps {
  items: QueueItem[];
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
}

export function QueueDetailsView({ items, onRetry, onCancel }: QueueDetailsViewProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <QueueDetailCard key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
      ))}
    </div>
  );
}
