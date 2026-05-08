"use client";

/**
 * @file PlatformPreview.tsx
 * @description Live preview component rendering post content as it would
 *              appear on each selected social platform. Owns the tab
 *              selector + provider dispatcher; the per-platform render
 *              lives in `previews/<Platform>Preview.tsx`. Maps `mediaFiles`
 *              (`File[]`) to stable blob URLs via `useObjectURLs` so child
 *              previews never call `URL.createObjectURL` themselves.
 * @component PlatformPreview
 * @layer infrastructure
 */

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { providerRegistry } from "@/lib/providers/registry";
import {
  BlueskyPreview,
  FacebookPreview,
  InstagramPreview,
  LinkedInPreview,
  PinterestPreview,
  SnapchatPreview,
  TelegramPreview,
  TikTokPreview,
  TwitterPreview,
  YouTubePreview,
  useObjectURLs,
  type PreviewMedia,
  type PreviewProps,
  type ThreadedPreviewProps,
  type ThreadSegment,
} from "./previews";

interface PlatformPreviewProps {
  content: string;
  mediaFiles: File[];
  selectedProviders: string[];
  userInfo?: {
    name: string;
    username: string;
    avatar?: string;
  };
}

/**
 * @component PlatformPreview
 * @description Live preview rendering post content as it would appear on each selected
 *   social platform. Each platform is rendered by a dedicated component under
 *   `previews/`; this component owns the active-tab state and dispatches to the right
 *   one based on `activeProvider`.
 * @param props.selectedProviders - Platforms to render preview tabs for
 */
export function PlatformPreview({
  content,
  mediaFiles,
  selectedProviders,
  userInfo = { name: "Your Name", username: "yourusername" },
}: PlatformPreviewProps) {
  const [activeProvider, setActiveProvider] = useState<string>(selectedProviders[0] || "x");

  const activeProviderData = providerRegistry.getProvider(activeProvider);

  const threadSegments: ThreadSegment[] = useMemo(
    () =>
      activeProviderData
        ? providerRegistry.getThreadSegments(activeProvider, content).map((text, index) => ({
            text,
            index: index + 1,
            charCount: text.length,
          }))
        : [{ text: content, index: 1, charCount: content.length }],
    [activeProvider, activeProviderData, content]
  );

  const objectUrls = useObjectURLs(mediaFiles);
  const media: PreviewMedia[] = useMemo(
    () =>
      mediaFiles.map((file, idx) => ({
        url: objectUrls[idx] ?? "",
        isImage: file.type.startsWith("image/"),
      })),
    [mediaFiles, objectUrls]
  );

  const previewProps: PreviewProps = { content, media, userInfo };
  const threadedPreviewProps: ThreadedPreviewProps = { ...previewProps, threadSegments };

  const renderPreview = () => {
    switch (activeProvider) {
      case "x":
      case "twitter":
        return <TwitterPreview {...threadedPreviewProps} />;
      case "instagram":
        return <InstagramPreview {...previewProps} />;
      case "facebook":
        return <FacebookPreview {...previewProps} />;
      case "tiktok":
        return <TikTokPreview {...previewProps} />;
      case "youtube":
        return <YouTubePreview {...previewProps} />;
      case "snapchat":
        return <SnapchatPreview {...previewProps} />;
      case "pinterest":
        return <PinterestPreview {...previewProps} />;
      case "telegram":
        return <TelegramPreview {...previewProps} />;
      case "linkedin":
        return <LinkedInPreview {...previewProps} />;
      case "bluesky":
        return <BlueskyPreview {...threadedPreviewProps} />;
      default:
        return <TwitterPreview {...threadedPreviewProps} />;
    }
  };

  const availableProviders = providerRegistry
    .getAllProviders()
    .filter((p) => selectedProviders.length === 0 || selectedProviders.includes(p.id));

  const hasContent = content.trim() || mediaFiles.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Platform Preview</span>
          {availableProviders.length > 1 && (
            <div className="flex gap-1">
              {availableProviders.map((provider) => (
                <Button
                  key={provider.id}
                  variant={activeProvider === provider.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveProvider(provider.id)}
                  className="h-8"
                >
                  <div
                    className="w-3 h-3 rounded-xs mr-2"
                    style={{ backgroundColor: provider.color }}
                  />
                  {provider.displayName}
                </Button>
              ))}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasContent ? (
          <div className="space-y-4">
            {renderPreview()}

            {threadSegments.length > 1 && (
              <div className="text-sm text-muted-foreground text-center">
                This content will be posted as a thread with {threadSegments.length} parts
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            Start typing or add media to see a preview
          </div>
        )}
      </CardContent>
    </Card>
  );
}
