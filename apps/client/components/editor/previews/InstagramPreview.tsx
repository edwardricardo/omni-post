/**
 * @file InstagramPreview.tsx
 * @description Instagram feed-post preview: square media on top, action row,
 *              caption with `@username` prefix and `#hashtag` highlighting.
 * @component InstagramPreview
 * @layer infrastructure
 */

import { Avatar, AvatarFallback, AvatarImage, Button } from "@packages/ui";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Share } from "lucide-react";
import { HashtagText } from "./HashtagText";
import type { PreviewProps } from "./types";

export function InstagramPreview({ content, media, userInfo }: PreviewProps) {
  return (
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

      {media[0] && (
        <div className="aspect-square bg-gray-100">
          <img src={media[0].url} alt="" className="w-full h-full object-cover" />
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
          <span className="text-sm ml-2">
            <HashtagText text={content} hashtagClassName="text-blue-700" />
          </span>
        </div>

        <div className="text-gray-500 text-xs mt-1">2 HOURS AGO</div>
      </div>
    </div>
  );
}
