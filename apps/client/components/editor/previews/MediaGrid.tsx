/**
 * @file MediaGrid.tsx
 * @description 1/2/3/4-image responsive grid used by both X (Twitter) and
 *              Bluesky previews. The two platforms render the same media
 *              layout; extracting the grid here removes the ~40 LOC of
 *              duplicated JSX that used to live in both inline previews.
 * @component MediaGrid
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { cn } from "@packages/ui";
import type { PreviewMedia } from "./types";

interface MediaGridProps {
  /** Up to 4 visible items; remaining items are summarised as a "+N" badge. */
  media: PreviewMedia[];
  /** When true, surfaces the "+N" overflow badge on the 4th tile (X behaviour). */
  showOverflowBadge?: boolean;
}

/**
 * Renders the canonical X/Bluesky media grid: 1=full-width video aspect,
 * 2=side-by-side, 3=one tall + two square, 4=2x2.
 */
export function MediaGrid({ media, showOverflowBadge = false }: MediaGridProps) {
  const t = useTranslations("editor");
  if (media.length === 0) return null;
  const visible = media.slice(0, 4);
  const overflowCount = Math.max(0, media.length - 3);
  return (
    <div
      className={cn(
        "mt-3 grid gap-1 rounded-xl overflow-hidden",
        media.length === 1 ? "grid-cols-1" : "grid-cols-2"
      )}
    >
      {visible.map((item, index) => (
        <div
          key={index}
          className={cn(
            "relative bg-gray-100",
            media.length === 3 && index === 0 ? "row-span-2" : "",
            media.length === 1 ? "aspect-video max-h-80" : "aspect-square"
          )}
        >
          {item.isImage ? (
            <img src={item.url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-black flex items-center justify-center text-white">
              {t("preview.video")}
            </div>
          )}
          {showOverflowBadge && media.length > 4 && index === 3 && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center text-white font-bold">
              +{overflowCount}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
