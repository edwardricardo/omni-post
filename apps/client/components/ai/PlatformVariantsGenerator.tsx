/**
 * @file PlatformVariantsGenerator.tsx
 * @description UI for generating platform-native content variants from a brief.
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { Sparkles, Copy, Check } from "lucide-react";
import { usePlatformVariants } from "@/hooks/api/usePlatformVariants";
import type { PlatformVariant } from "@/hooks/api/usePlatformVariants";

interface PlatformVariantsGeneratorProps {
  accountId: string;
  connectedPlatforms?: string[];
}

const ALL_PLATFORMS = [
  "X",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "FACEBOOK",
  "YOUTUBE",
  "BLUESKY",
] as const;

export function PlatformVariantsGenerator({
  accountId,
  connectedPlatforms,
}: PlatformVariantsGeneratorProps) {
  const [brief, setBrief] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(connectedPlatforms ?? ["X", "INSTAGRAM", "LINKEDIN"])
  );
  const [usePerformanceData, setUsePerformanceData] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const mutation = usePlatformVariants();

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    if (!brief.trim() || selectedPlatforms.size === 0) return;
    mutation.mutate({
      brief: brief.trim(),
      platforms: Array.from(selectedPlatforms),
      accountId,
      usePerformanceData,
    });
  }, [brief, selectedPlatforms, accountId, usePerformanceData, mutation]);

  const handleCopy = useCallback((variant: PlatformVariant) => {
    navigator.clipboard.writeText(variant.content);
    setCopiedId(variant.platform);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="variant-brief">What do you want to say?</Label>
        <textarea
          id="variant-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Share your core message or idea..."
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none mt-1"
        />
      </div>

      <div>
        <Label>Platforms</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {ALL_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                selectedPlatforms.has(p)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={usePerformanceData}
          onChange={(e) => setUsePerformanceData(e.target.checked)}
          className="rounded"
        />
        Use my best-performing posts as examples
      </label>

      <Button
        onClick={handleGenerate}
        disabled={!brief.trim() || selectedPlatforms.size === 0 || mutation.isPending}
      >
        <Sparkles className="h-4 w-4 mr-2" />
        {mutation.isPending ? "Generating..." : "Generate Variants"}
      </Button>

      {mutation.data && (
        <div className="space-y-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Generated in {mutation.data.generationMs}ms
          </p>
          {mutation.data.variants.map((variant) => (
            <div key={variant.platform} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">{variant.platform}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {variant.charCount}/{variant.charLimit}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(variant)}>
                    {copiedId === variant.platform ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{variant.content}</p>
              {variant.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {variant.hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
