/**
 * @file FacebookPreview.tsx
 * @description Facebook feed-post preview: header, body with "See more"
 *              truncation past 400 chars, single hero image, like/comment/share row.
 * @component FacebookPreview
 * @layer infrastructure
 */

import { Avatar, AvatarFallback, AvatarImage, Button } from "@packages/ui";
import { MessageCircle, MoreHorizontal, Share } from "lucide-react";
import type { PreviewProps } from "./types";

const FACEBOOK_PREVIEW_LIMIT = 400;

export function FacebookPreview({ content, media, userInfo }: PreviewProps) {
  const preview =
    content.length > FACEBOOK_PREVIEW_LIMIT ? content.slice(0, FACEBOOK_PREVIEW_LIMIT) : content;
  const hasMore = content.length > FACEBOOK_PREVIEW_LIMIT;
  return (
    <div className="bg-white border rounded-lg max-w-lg mx-auto">
      <div className="p-3 flex items-center space-x-2">
        <Avatar className="w-10 h-10">
          <AvatarImage src={userInfo.avatar} />
          <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold text-sm text-gray-900">{userInfo.name}</p>
          <p className="text-xs text-gray-500">Just now · 🌐</p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <p className="text-sm text-gray-900 whitespace-pre-wrap">
          {preview}
          {hasMore && <span className="text-blue-600 cursor-pointer"> See more</span>}
        </p>
      </div>
      {media[0] && (
        <div className="bg-gray-100">
          <img src={media[0].url} alt="" className="w-full object-cover max-h-80" />
        </div>
      )}
      <div className="px-3 py-2 border-t flex items-center justify-around text-gray-500 text-sm">
        <Button variant="ghost" size="sm" className="flex items-center gap-1">
          <span>👍</span>
          <span>Like</span>
        </Button>
        <Button variant="ghost" size="sm" className="flex items-center gap-1">
          <MessageCircle className="w-4 h-4" />
          <span>Comment</span>
        </Button>
        <Button variant="ghost" size="sm" className="flex items-center gap-1">
          <Share className="w-4 h-4" />
          <span>Share</span>
        </Button>
      </div>
    </div>
  );
}
