"use client";

/**
 * @file AssetTagBadge.tsx
 * @description Colored badge component for displaying an asset tag label.
 *   Supports an optional remove button for interactive tag management.
 */

import React, { useCallback } from "react";

interface AssetTagBadgeProps {
  /** Unique tag identifier */
  id: string;
  /** Tag display name */
  name: string;
  /** Hex color for the badge background (e.g., "#6366f1") */
  color: string;
  /** Whether to show a remove button (x) */
  removable?: boolean;
  /** Callback when the remove button is clicked */
  onRemove?: (id: string) => void;
}

/**
 * Determines whether to use white or black text based on the background color
 * luminance (WCAG contrast calculation).
 */
function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6) return "#ffffff";

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function AssetTagBadge({
  id,
  name,
  color,
  removable = false,
  onRemove,
}: AssetTagBadgeProps) {
  const textColor = getContrastTextColor(color);

  const handleRemove = useCallback(() => {
    if (onRemove) {
      onRemove(id);
    }
  }, [id, onRemove]);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: color,
        color: textColor,
      }}
      data-tag-id={id}
    >
      {name}
      {removable && onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:opacity-75 focus:outline-none"
          style={{ color: textColor }}
          aria-label={`Remove tag ${name}`}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
