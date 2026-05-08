/**
 * @file YouTubePreview.tsx
 * @description YouTube watch-page preview with thumbnail, title (first 70
 *              chars of content), channel attribution, and 200-char
 *              description excerpt.
 * @component YouTubePreview
 * @layer infrastructure
 */

import { Avatar, AvatarFallback, AvatarImage } from "@packages/ui";
import type { PreviewProps } from "./types";

const YOUTUBE_TITLE_LIMIT = 70;
const YOUTUBE_DESCRIPTION_LIMIT = 200;

export function YouTubePreview({ content, media, userInfo }: PreviewProps) {
  const title =
    content.length > YOUTUBE_TITLE_LIMIT ? content.slice(0, YOUTUBE_TITLE_LIMIT) : content;
  const description = content.slice(0, YOUTUBE_DESCRIPTION_LIMIT);
  return (
    <div className="bg-white border rounded-lg max-w-lg mx-auto overflow-hidden">
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {media[0] ? (
          <img src={media[0].url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-white text-5xl">▶</div>
        )}
      </div>
      <div className="p-3">
        <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{title}</p>
        <div className="flex items-center gap-2 mt-2">
          <Avatar className="w-8 h-8">
            <AvatarImage src={userInfo.avatar} />
            <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-xs font-medium text-gray-800">{userInfo.name}</p>
            <p className="text-xs text-gray-500">0 views · Just now</p>
          </div>
        </div>
        {content.length > 0 && (
          <p className="mt-2 text-xs text-gray-600 line-clamp-3">{description}</p>
        )}
      </div>
    </div>
  );
}
