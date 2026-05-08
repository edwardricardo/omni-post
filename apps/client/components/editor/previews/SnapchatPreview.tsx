/**
 * @file SnapchatPreview.tsx
 * @description Snapchat 9:16 ephemeral-snap preview with centered caption
 *              and an "exceeds 250 chars" warning when content is too long.
 * @component SnapchatPreview
 * @layer infrastructure
 */

import { Avatar, AvatarFallback } from "@packages/ui";
import type { PreviewProps } from "./types";

const SNAPCHAT_LIMIT = 250;

export function SnapchatPreview({ content, media, userInfo }: PreviewProps) {
  const tooLong = content.length > SNAPCHAT_LIMIT;
  return (
    <div
      className="relative bg-gray-900 rounded-xl mx-auto overflow-hidden"
      style={{ width: 280, height: 497 }}
    >
      {media[0] ? (
        <img src={media[0].url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-yellow-400 to-yellow-300" />
      )}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <Avatar className="w-8 h-8 border-2 border-white">
          <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
        </Avatar>
        <span className="text-white text-xs font-medium">⏱ 10s</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <p className="text-white text-xl font-bold text-center drop-shadow-lg">
          {content.slice(0, SNAPCHAT_LIMIT)}
        </p>
      </div>
      {tooLong && (
        <div className="absolute bottom-4 left-4 right-4 bg-yellow-400/90 rounded-md p-2">
          <p className="text-xs text-gray-900 font-medium text-center">
            ⚠ Caption exceeds 250 characters ({content.length - SNAPCHAT_LIMIT} over limit)
          </p>
        </div>
      )}
    </div>
  );
}
