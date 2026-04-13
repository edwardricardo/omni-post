/**
 * @file AssetDetailPanel.tsx
 * @description Slide-over panel showing full asset details.
 * @layer client-components
 */

"use client";

import { useCallback } from "react";
import { Button } from "@packages/ui";
import { X, Trash2, Download, Copy } from "lucide-react";
import type { MediaAssetDto } from "@/hooks/api/useAssets";
import { useDeleteAsset } from "@/hooks/api/useAssets";

interface AssetDetailPanelProps {
  asset: MediaAssetDto | null;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * @component AssetDetailPanel
 * @description Slide-over panel displaying full asset details including image preview,
 *              metadata (type, size, dimensions, upload date), and actions for copying
 *              URL, downloading, and deleting the asset.
 * @param props.asset - The media asset to display, or null to hide the panel
 * @param props.onClose - Callback to dismiss the panel
 */
export function AssetDetailPanel({ asset, onClose }: AssetDetailPanelProps) {
  const deleteMutation = useDeleteAsset();

  const handleDelete = useCallback(async () => {
    if (!asset) return;
    await deleteMutation.mutateAsync(asset.id);
    onClose();
  }, [asset, deleteMutation, onClose]);

  const handleCopyUrl = useCallback(() => {
    if (!asset) return;
    navigator.clipboard.writeText(asset.url);
  }, [asset]);

  if (!asset) return null;

  const isImage = asset.mimeType.startsWith("image/");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-card border-l shadow-lg overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Asset Details</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {isImage && (
            <div className="rounded-lg overflow-hidden border bg-muted">
              <img src={asset.url} alt={asset.name} className="w-full object-contain max-h-64" />
            </div>
          )}

          <div>
            <h3 className="text-lg font-medium">{asset.name}</h3>
            {asset.description && (
              <p className="text-sm text-muted-foreground mt-1">{asset.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Type</span>
              <p className="font-medium">{asset.mimeType}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Size</span>
              <p className="font-medium">{formatSize(asset.sizeBytes)}</p>
            </div>
            {asset.width && asset.height && (
              <div>
                <span className="text-muted-foreground">Dimensions</span>
                <p className="font-medium">
                  {asset.width} x {asset.height}
                </p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Uploaded</span>
              <p className="font-medium">{new Date(asset.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={handleCopyUrl} className="flex-1">
              <Copy className="h-4 w-4 mr-1" />
              Copy URL
            </Button>
            <a
              href={asset.url}
              download={asset.name}
              className="flex-1"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="w-full">
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </a>
          </div>

          <div className="pt-4 border-t">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {deleteMutation.isPending ? "Deleting..." : "Delete Asset"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
