"use client";

/**
 * @file SmartContentOptimizerHashtags.tsx
 * @description Hashtags tab for the SmartContentOptimizer. Displays the list of
 *              suggested hashtags returned by the backend optimization call.
 *              Relevance / popularity / reach / trend metrics are not rendered
 *              because the backend does not produce them today; fabricating them
 *              on the client (by array index) would mislead users about data
 *              provenance.
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import type { HashtagAnalysis } from "./smartContentOptimizerUtils";

interface SmartContentOptimizerHashtagsProps {
  hashtagAnalysis: HashtagAnalysis[];
}

/**
 * @component SmartContentOptimizerHashtags
 * @description Hashtag suggestions tab displaying the suggested tags with
 * their target platforms.
 */
export function SmartContentOptimizerHashtags({
  hashtagAnalysis,
}: SmartContentOptimizerHashtagsProps) {
  const t = useTranslations("ai.components");
  if (hashtagAnalysis.length === 0) {
    return <div className="text-center py-10 text-sm text-gray-500">{t("hashtags.empty")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">{t("hashtags.title")}</h4>
        <div className="text-sm text-gray-600">{t("hashtags.returnedBy")}</div>
      </div>

      <div className="grid gap-3">
        {hashtagAnalysis.map((hashtag) => (
          <div
            key={hashtag.hashtag}
            className="border rounded-lg p-3 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="text-lg font-semibold text-blue-600">{hashtag.hashtag}</span>
            <div className="flex items-center gap-2">
              {hashtag.platforms.map((platform) => (
                <span
                  key={platform}
                  className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-sm"
                >
                  {platform}
                </span>
              ))}
              <button
                type="button"
                className="ml-2 px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                {t("hashtags.addToContent")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
