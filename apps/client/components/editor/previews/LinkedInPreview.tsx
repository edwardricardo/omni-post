/**
 * @file LinkedInPreview.tsx
 * @description LinkedIn feed-post preview with professional-style header
 *              ("Title • 1st"), body text, optional inline image, and the
 *              Like/Comment/Repost/Send action row.
 * @component LinkedInPreview
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@packages/ui";
import { MessageCircle, MoreHorizontal, Repeat2, Share } from "lucide-react";
import type { PreviewProps } from "./types";

export function LinkedInPreview({ content, media, userInfo }: PreviewProps) {
  const t = useTranslations("editor");
  return (
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
            <div className="text-sm text-gray-500">{t("preview.linkedinHeadline")}</div>
            <div className="text-xs text-gray-500">{t("preview.now")}</div>
          </div>
          <Button variant="ghost" size="sm">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-3">
          <p className="text-gray-900 whitespace-pre-wrap">{content}</p>

          {media[0] && (
            <div className="mt-3 rounded-sm overflow-hidden">
              <img src={media[0].url} alt="" className="w-full h-auto max-h-96 object-cover" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 mt-3 border-t">
          <div className="flex items-center space-x-6">
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <span>👍</span>
              <span className="text-sm">{t("preview.like")}</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm">{t("preview.comment")}</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <Repeat2 className="w-4 h-4" />
              <span className="text-sm">{t("preview.repost")}</span>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center space-x-2">
              <Share className="w-4 h-4" />
              <span className="text-sm">{t("preview.send")}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
