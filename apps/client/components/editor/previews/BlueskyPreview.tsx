/**
 * @file BlueskyPreview.tsx
 * @description Bluesky preview with the same media grid as X but enforces
 *              a 300-char limit and surfaces a `count/limit` counter under
 *              the action row.
 * @component BlueskyPreview
 * @layer infrastructure
 */

import { Avatar, AvatarFallback, AvatarImage, Button } from "@packages/ui";
import { Heart, MessageCircle, Repeat2, Share } from "lucide-react";
import { cn } from "@packages/ui";
import { HashtagText } from "./HashtagText.js";
import { MediaGrid } from "./MediaGrid.js";
import type { ThreadedPreviewProps } from "./types.js";

const BLUESKY_LIMIT = 300;

export function BlueskyPreview({ content, media, userInfo }: ThreadedPreviewProps) {
  const displayText = content.slice(0, BLUESKY_LIMIT);
  const overLimit = content.length > BLUESKY_LIMIT;
  return (
    <div className="bg-white border rounded-lg max-w-lg mx-auto">
      <div className="p-4">
        <div className="flex items-start space-x-3">
          <Avatar className="w-10 h-10">
            <AvatarImage src={userInfo.avatar} />
            <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1">
              <span className="font-bold text-gray-900">{userInfo.name}</span>
              <span className="text-gray-500">@{userInfo.username}</span>
            </div>
            <div className="mt-1">
              <p className="text-gray-900 whitespace-pre-wrap">
                <HashtagText text={displayText} hashtagClassName="text-blue-500" />
              </p>
              <MediaGrid media={media} />
            </div>
            <div className="flex items-center justify-between max-w-md mt-3 text-gray-500">
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center space-x-2 hover:text-blue-500"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="text-sm">5</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center space-x-2 hover:text-green-500"
              >
                <Repeat2 className="w-4 h-4" />
                <span className="text-sm">12</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center space-x-2 hover:text-red-500"
              >
                <Heart className="w-4 h-4" />
                <span className="text-sm">89</span>
              </Button>
              <Button variant="ghost" size="sm" className="hover:text-blue-500">
                <Share className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex justify-end mt-1">
              <span
                className={cn("text-xs", overLimit ? "text-red-500 font-medium" : "text-gray-400")}
              >
                {content.length}/{BLUESKY_LIMIT}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
