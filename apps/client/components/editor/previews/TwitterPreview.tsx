/**
 * @file TwitterPreview.tsx
 * @description X (Twitter) preview. Renders threaded content as separate
 *              cards stacked vertically, with media attached to the first
 *              segment only. Hashtags are highlighted via `HashtagText`.
 * @component TwitterPreview
 * @layer infrastructure
 */

import { cn } from "@packages/ui";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@packages/ui";
import { Bookmark, Heart, MessageCircle, Repeat2, Share } from "lucide-react";
import { HashtagText } from "./HashtagText";
import { MediaGrid } from "./MediaGrid";
import type { ThreadedPreviewProps } from "./types";

export function TwitterPreview({ media, userInfo, threadSegments }: ThreadedPreviewProps) {
  return (
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
                <p className="text-gray-900 whitespace-pre-wrap">
                  <HashtagText text={segment.text} hashtagClassName="text-blue-500" />
                </p>
                {idx === 0 && <MediaGrid media={media} showOverflowBadge />}
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
}
