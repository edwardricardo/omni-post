/**
 * @file MentionsFeed.tsx
 * @description Chronological list of brand mentions with author, body, provider /
 *   tracked-term-kind / sentiment badges, timestamp, and an external link to the
 *   source post. Pure presentational list (no charts).
 * @component MentionsFeed
 * @layer infrastructure
 */
"use client";

import { useTranslations, useLocale } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { Mention } from "@/hooks/api/useListening";

interface MentionsFeedProps {
  /** Mentions to render, newest first. */
  mentions: Mention[];
}

/**
 * Renders the brand-mention feed as a list of cards.
 */
export function MentionsFeed({ mentions }: MentionsFeedProps) {
  const t = useTranslations("listening");
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  if (mentions.length === 0) {
    return <p className="text-sm text-gray-500">{t("feedEmpty")}</p>;
  }

  return (
    <ul className="divide-y divide-gray-200" aria-label={t("feedAria")}>
      {mentions.map((mention) => (
        <li key={mention.id} className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {mention.authorName}
                {mention.authorHandle ? (
                  <span className="ml-1 text-gray-500">@{mention.authorHandle}</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-gray-700">{mention.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {mention.provider}
                </span>
                {mention.trackedTermKind ? (
                  <span className="rounded-sm bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                    {mention.trackedTermKind === "BRAND" ? t("brand") : t("market")}
                  </span>
                ) : null}
                {mention.sentimentLabel ? (
                  <span className="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    {mention.sentimentLabel}
                  </span>
                ) : null}
                <time className="text-xs text-gray-400" dateTime={mention.providerCreatedAt}>
                  {dateFormatter.format(new Date(mention.providerCreatedAt))}
                </time>
              </div>
            </div>
            {mention.url ? (
              <a
                href={mention.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-gray-400 hover:text-gray-600"
                aria-label={t("openMention")}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
