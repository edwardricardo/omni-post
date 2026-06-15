/**
 * @file PinterestPreview.tsx
 * @description Pinterest pin preview with 2:3 image aspect, "Save" CTA,
 *              and a 200-char description excerpt.
 * @component PinterestPreview
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import type { PreviewProps } from "./types";

const PIN_DESCRIPTION_LIMIT = 200;

export function PinterestPreview({ content, media, userInfo }: PreviewProps) {
  const t = useTranslations("editor");
  const pinDescription =
    content.length > PIN_DESCRIPTION_LIMIT
      ? content.slice(0, PIN_DESCRIPTION_LIMIT) + "..."
      : content;
  return (
    <div className="bg-white rounded-xl max-w-xs mx-auto overflow-hidden shadow-md">
      <div className="bg-gray-100 relative" style={{ aspectRatio: "2/3" }}>
        {media[0] ? (
          <img src={media[0].url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            {t("preview.pinterestImagePlaceholder")}
          </div>
        )}
        <button className="absolute top-3 right-3 bg-red-600 text-white text-sm font-semibold rounded-full px-3 py-1">
          {t("preview.save")}
        </button>
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm text-gray-900 truncate">{userInfo.name}</p>
        <p className="text-sm text-gray-700 mt-1 line-clamp-3">{pinDescription}</p>
        <p className="text-xs text-gray-400 mt-2">
          {userInfo.username} · {t("preview.pinterestBoard")}
        </p>
      </div>
    </div>
  );
}
