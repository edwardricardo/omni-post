/**
 * @file AssetThumbnail.tsx
 * @description Thumbnail component for displaying media assets in grid/list.
 * @layer client-components
 */

"use client";

import { useCallback } from "react";
import { FileImage, Film, FileText, Music, Paperclip } from "lucide-react";
import type { MediaAssetDto } from "@/hooks/api/useAssets";

interface AssetThumbnailProps {
  asset: MediaAssetDto;
  selected: boolean;
  onSelect: (id: string) => void;
  onClick: (asset: MediaAssetDto) => void;
}

function getTypeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  if (mimeType === "application/pdf") return FileText;
  return Paperclip;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * @component AssetThumbnail
 * @description Thumbnail card for a single media asset. Renders image preview for
 *              images or a file-type icon for other media, with a selectable checkbox
 *              overlay on hover.
 * @param props.asset - The media asset data to render
 * @param props.selected - Whether this thumbnail is currently selected
 * @param props.onSelect - Callback to toggle selection state
 * @param props.onClick - Callback when the thumbnail body is clicked
 */
export function AssetThumbnail({ asset, selected, onSelect, onClick }: AssetThumbnailProps) {
  const isImage = asset.mimeType.startsWith("image/");
  const Icon = getTypeIcon(asset.mimeType);

  const handleClick = useCallback(() => onClick(asset), [asset, onClick]);
  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(asset.id);
    },
    [asset.id, onSelect]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
      className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-all ${
        selected ? "ring-2 ring-primary border-primary" : "hover:shadow-sm"
      }`}
    >
      <div className="aspect-square bg-muted flex items-center justify-center">
        {isImage ? (
          <img
            src={asset.url}
            alt={asset.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="h-10 w-10 text-muted-foreground" />
        )}
      </div>

      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={handleSelect}
          className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-white/80 border-gray-300"
          }`}
        >
          {selected && <span className="text-xs">&#10003;</span>}
        </button>
      </div>

      <div className="p-2">
        <p className="text-xs font-medium truncate">{asset.name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(asset.sizeBytes)}</p>
      </div>
    </div>
  );
}
