/**
 * @file page.tsx
 * @description Standalone asset library page with folders, grid, and detail panel.
 * @layer client-pages
 */

"use client";

import { useState } from "react";
import { Button, Input } from "@packages/ui";
import { Upload, Search } from "lucide-react";
import { FolderSidebar } from "@/components/assets/FolderSidebar";
import { AssetGrid } from "@/components/assets/AssetGrid";
import { AssetDetailPanel } from "@/components/assets/AssetDetailPanel";
import type { MediaAssetDto } from "@/hooks/api/useAssets";

export default function AssetsPage() {
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedAsset, setSelectedAsset] = useState<MediaAssetDto | null>(null);
  const [search, setSearch] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Asset Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and organize your brand assets
          </p>
        </div>
        <Button>
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </div>

      <div className="flex gap-6">
        <div className="w-56 shrink-0 hidden md:block">
          <FolderSidebar selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="pl-9"
            />
          </div>

          <AssetGrid folderId={selectedFolderId} search={search} onAssetClick={setSelectedAsset} />
        </div>
      </div>

      <AssetDetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
    </div>
  );
}
