/**
 * @file TelegramPreview.tsx
 * @description Telegram chat-bubble preview rendering the channel message
 *              as if seen by a subscriber, with optional inline image.
 * @component TelegramPreview
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@packages/ui";
import type { PreviewProps } from "./types.js";

const TELEGRAM_CAPTION_LIMIT = 4096;

export function TelegramPreview({ content, media, userInfo }: PreviewProps) {
  const t = useTranslations("editor");
  const body =
    content.length > TELEGRAM_CAPTION_LIMIT
      ? content.slice(0, TELEGRAM_CAPTION_LIMIT) + "..."
      : content;
  return (
    <div className="bg-gray-100 rounded-xl max-w-sm mx-auto p-4 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Avatar className="w-9 h-9">
          <AvatarImage src={userInfo.avatar} />
          <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-semibold text-blue-600">{userInfo.name}</p>
        </div>
      </div>
      <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 shadow-sm max-w-xs">
        {media[0] && (
          <img src={media[0].url} alt="" className="w-full rounded-lg mb-2 object-cover max-h-48" />
        )}
        <p className="text-sm text-gray-900 whitespace-pre-wrap">{body}</p>
        <p className="text-right text-xs text-gray-400 mt-1">{t("preview.now")} ✓✓</p>
      </div>
    </div>
  );
}
