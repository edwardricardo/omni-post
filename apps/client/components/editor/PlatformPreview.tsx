"use client";

/**
 * @file PlatformPreview.tsx
 * @description Live preview component rendering post content as it would appear on
 * each selected social platform, with thread segmentation and media thumbnails.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@packages/ui";
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, Bookmark } from "lucide-react";
import { cn } from "@packages/ui";
import { providerRegistry, type ProviderConfig as _ProviderConfig } from "@/lib/providers/registry";

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

interface ThreadSegment {
  text: string;
  index: number;
  charCount: number;
}

export function PlatformPreview({
  content,
  mediaFiles,
  selectedProviders,
  userInfo = { name: "Your Name", username: "yourusername" },
}: PlatformPreviewProps) {
  const [activeProvider, setActiveProvider] = useState<string>(selectedProviders[0] || "x");

  const activeProviderData = providerRegistry.getProvider(activeProvider);

  // Split content into threads based on character limits
  const _createThreadSegments = (text: string, charLimit: number): ThreadSegment[] => {
    if (text.length <= charLimit) {
      return [{ text, index: 1, charCount: text.length }];
    }

    const segments: ThreadSegment[] = [];
    let remaining = text;
    let index = 1;

    while (remaining.length > 0) {
      let segmentText = remaining.substring(0, charLimit);

      // Try to break at word boundaries for better readability
      if (remaining.length > charLimit) {
        const lastSpace = segmentText.lastIndexOf(" ");
        if (lastSpace > charLimit * 0.7) {
          // Only break at word if it's not too short
          segmentText = segmentText.substring(0, lastSpace);
        }
      }

      segments.push({
        text: segmentText,
        index,
        charCount: segmentText.length,
      });

      remaining = remaining.substring(segmentText.length).trim();
      index++;
    }

    return segments;
  };

  const threadSegments = activeProviderData
    ? providerRegistry.getThreadSegments(activeProvider, content).map((text, index) => ({
        text,
        index: index + 1,
        charCount: text.length,
      }))
    : [{ text: content, index: 1, charCount: content.length }];

  const renderTwitterPreview = () => (
    <div className="bg-white border rounded-lg max-w-lg mx-auto">
      {threadSegments.map((segment, idx) => (
        <div key={idx} className={cn("p-4", idx > 0 && "border-t")}>
          <div className="flex space-x-3">
            <Avatar className="w-10 h-10">
              <AvatarImage src={userInfo.avatar} />
              <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-1">
                <span className="font-bold text-gray-900">{userInfo.name}</span>
                <span className="text-gray-500">@{userInfo.username}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-500">now</span>
                {threadSegments.length > 1 && (
                  <span className="text-blue-500 text-sm">
                    {segment.index}/{threadSegments.length}
                  </span>
                )}
              </div>
              <div className="mt-1">
                <p className="text-gray-900 whitespace-pre-wrap">{segment.text}</p>
                {idx === 0 && mediaFiles.length > 0 && (
                  <div
                    className={cn(
                      "mt-3 grid gap-1 rounded-xl overflow-hidden",
                      mediaFiles.length === 1
                        ? "grid-cols-1"
                        : mediaFiles.length === 2
                          ? "grid-cols-2"
                          : mediaFiles.length === 3
                            ? "grid-cols-2"
                            : "grid-cols-2"
                    )}
                  >
                    {mediaFiles.slice(0, 4).map((file, mediaIdx) => (
                      <div
                        key={mediaIdx}
                        className={cn(
                          "relative bg-gray-100",
                          mediaFiles.length === 3 && mediaIdx === 0 ? "row-span-2" : "",
                          mediaFiles.length === 1 ? "aspect-video max-h-80" : "aspect-square"
                        )}
                      >
                        {file.type.startsWith("image/") ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-black flex items-center justify-center text-white">
                            Video
                          </div>
                        )}
                        {mediaFiles.length > 4 && mediaIdx === 3 && (
                          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center text-white font-bold">
                            +{mediaFiles.length - 3}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between max-w-md mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center space-x-2 text-gray-500 hover:text-blue-500"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="text-sm">12</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center space-x-2 text-gray-500 hover:text-green-500"
                >
                  <Repeat2 className="w-4 h-4" />
                  <span className="text-sm">23</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center space-x-2 text-gray-500 hover:text-red-500"
                >
                  <Heart className="w-4 h-4" />
                  <span className="text-sm">145</span>
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-500 hover:text-blue-500">
                  <Bookmark className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-500 hover:text-blue-500">
                  <Share className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderInstagramPreview = () => (
    <div className="bg-white border rounded-lg max-w-sm mx-auto">
      <div className="p-3 border-b flex items-center space-x-3">
        <Avatar className="w-8 h-8">
          <AvatarImage src={userInfo.avatar} />
          <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <span className="font-semibold text-sm">{userInfo.username}</span>
        </div>
        <Button variant="ghost" size="sm">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {mediaFiles.length > 0 && mediaFiles[0] && (
        <div className="aspect-square bg-gray-100">
          <img
            src={URL.createObjectURL(mediaFiles[0])}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-4">
            <Heart className="w-6 h-6" />
            <MessageCircle className="w-6 h-6" />
            <Share className="w-6 h-6" />
          </div>
          <Bookmark className="w-6 h-6" />
        </div>

        <div className="text-sm">
          <span className="font-semibold">1,234 likes</span>
        </div>

        <div className="mt-1">
          <span className="font-semibold text-sm">{userInfo.username}</span>
          <span className="text-sm ml-2">{content}</span>
        </div>

        <div className="text-gray-500 text-xs mt-1">2 HOURS AGO</div>
      </div>
    </div>
  );

  const renderLinkedInPreview = () => (
    <div className="bg-white border rounded-lg max-w-lg mx-auto">
      <div className="p-4">
        <div className="flex items-start space-x-3">
          <Avatar className="w-12 h-12">
            <AvatarImage src={userInfo.avatar} />
            <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center space-x-1">
              <span className="font-semibold text-gray-900">{userInfo.name}</span>
            </div>
            <div className="text-sm text-gray-500">Professional Title • 1st</div>
            <div className="text-xs text-gray-500">now</div>
          </div>
          <Button variant="ghost" size="sm">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-3">
          <p className="text-gray-900 whitespace-pre-wrap">{content}</p>

          {mediaFiles.length > 0 && mediaFiles[0] && (
            <div className="mt-3 rounded-sm overflow-hidden">
              <img
                src={URL.createObjectURL(mediaFiles[0])}
                alt=""
                className="w-full h-auto max-h-96 object-cover"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 mt-3 border-t">
          <div className="flex items-center space-x-6">
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <span>👍</span>
              <span className="text-sm">Like</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm">Comment</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <Repeat2 className="w-4 h-4" />
              <span className="text-sm">Repost</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <Share className="w-4 h-4" />
              <span className="text-sm">Send</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPreview = () => {
    switch (activeProvider) {
      case "x":
      case "twitter":
        return renderTwitterPreview();
      case "instagram":
        return renderInstagramPreview();
      case "linkedin":
        return renderLinkedInPreview();
      default:
        return renderTwitterPreview();
    }
  };

  const availableProviders = providerRegistry
    .getAllProviders()
    .filter((p) => selectedProviders.length === 0 || selectedProviders.includes(p.id));

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
        {content.trim() || mediaFiles.length > 0 ? (
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
