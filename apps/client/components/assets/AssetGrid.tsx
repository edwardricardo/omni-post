/**
 * @file AssetGrid.tsx
 * @description Grid of asset thumbnails with selection and bulk actions.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { Trash2 } from "lucide-react";
import { useAssets, useDeleteAsset } from "@/hooks/api/useAssets";
import type { MediaAssetDto } from "@/hooks/api/useAssets";
import { AssetThumbnail } from "./AssetThumbnail.js";

interface AssetGridProps {
  folderId: string | undefined;
  search: string;
  onAssetClick: (asset: MediaAssetDto) => void;
}

/**
 * @component AssetGrid
 * @description Responsive grid of asset thumbnails with multi-select capability and
 *              bulk delete action. Supports folder and search filtering.
 * @param props.folderId - Optional folder ID to filter assets by folder
 * @param props.search - Optional search string to filter assets by name
 * @param props.onAssetClick - Callback when an asset thumbnail is clicked
 */
export function AssetGrid({ folderId, search, onAssetClick }: AssetGridProps) {
  const t = useTranslations("assets.components");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data, isLoading } = useAssets({
    ...(folderId ? { folderId } : {}),
    ...(search ? { search } : {}),
  });
  const deleteMutation = useDeleteAsset();

  const assets = data?.items ?? [];

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedIds) {
      await deleteMutation.mutateAsync(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, deleteMutation]);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">{t("loading")}</div>;
  }

  if (assets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("emptyTitle")}</p>
        <p className="text-sm mt-1">{t("emptyDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 mb-4 rounded-lg border bg-muted/50">
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedIds.size })}
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {t("delete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            {t("clear")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {assets.map((asset) => (
          <AssetThumbnail
            key={asset.id}
            asset={asset}
            selected={selectedIds.has(asset.id)}
            onSelect={toggleSelect}
            onClick={onAssetClick}
          />
        ))}
      </div>
    </div>
  );
}
