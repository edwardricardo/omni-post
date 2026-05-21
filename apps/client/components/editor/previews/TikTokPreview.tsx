/**
 * @file TikTokPreview.tsx
 * @description TikTok 9:16 vertical-video preview with caption overlay.
 *              Caption is truncated to 150 chars and hashtags get the
 *              cyan accent TikTok itself uses.
 * @component TikTokPreview
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { HashtagText } from "./HashtagText";
import type { PreviewProps } from "./types";

const TIKTOK_CAPTION_LIMIT = 150;

export function TikTokPreview({ content, media, userInfo }: PreviewProps) {
  const t = useTranslations("editor");
  const caption =
    content.length > TIKTOK_CAPTION_LIMIT
      ? content.slice(0, TIKTOK_CAPTION_LIMIT) + "..."
      : content;
  return (
    <div
      className="relative bg-gray-900 rounded-xl mx-auto overflow-hidden"
      style={{ width: 280, height: 497 }}
    >
      {media[0] ? (
        <img src={media[0].url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
          <span>{t("preview.tiktokVideoPlaceholder")}</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <p className="text-white text-sm font-medium mb-1">@{userInfo.username}</p>
        <p className="text-white text-sm leading-snug">
          <HashtagText text={caption} hashtagClassName="text-cyan-400" />
        </p>
      </div>
    </div>
  );
}
