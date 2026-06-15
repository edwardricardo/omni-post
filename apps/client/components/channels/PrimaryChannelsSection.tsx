"use client";

/**
 * @file PrimaryChannelsSection.tsx
 * @description Self-contained settings section listing the project's connected
 *              channels grouped by provider with a `SetPrimaryChannelButton`
 *              per row. Pulls data directly from `useProjectChannels` so it
 *              works independently of the legacy channels page rendering.
 * @component PrimaryChannelsSection
 * @layer infrastructure
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProject } from "@/providers/ProjectProvider";
import { useProjectChannels, type ProjectChannel } from "@/lib/hooks/useProjectChannels";
import { Badge } from "@packages/ui";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { SetPrimaryChannelButton } from "./SetPrimaryChannelButton.js";

/**
 * @component PrimaryChannelsSection
 * @description Renders the project's channels grouped by provider and lets the
 *   user promote any channel to the primary slot for that (project, provider)
 *   pair. The primary channel becomes the default selection in the editor's
 *   `ChannelMultiSelect`. Designed to slot below other channel-management UI
 *   without requiring the rest of the page to be rewritten first.
 */
export function PrimaryChannelsSection() {
  const t = useTranslations("channels.components");
  const { projectId } = useProject();
  const channelsQuery = useProjectChannels(projectId);

  const grouped = useMemo(() => {
    const channels = channelsQuery.data ?? [];
    const groups = new Map<string, ProjectChannel[]>();
    for (const channel of channels) {
      const list = groups.get(channel.platform) ?? [];
      list.push(channel);
      groups.set(channel.platform, list);
    }
    return [...groups.entries()];
  }, [channelsQuery.data]);

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">{t("selectProject")}</p>;
  }

  if (channelsQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (channelsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("loadFailed", {
          error:
            channelsQuery.error instanceof Error ? channelsQuery.error.message : t("unknownError"),
        })}
      </p>
    );
  }

  if (grouped.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noChannels")}</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {grouped.map(([provider, channels]) => (
        <section
          key={provider}
          aria-labelledby={`primary-channels-${provider}`}
          className="rounded-md border border-border p-4"
        >
          <h3 id={`primary-channels-${provider}`} className="text-base font-medium">
            {provider}
          </h3>
          <ul className="mt-3 space-y-2">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-border/60 p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{channel.name}</span>
                  {channel.isPrimary && (
                    <Badge variant="secondary" aria-label={t("defaultChannelAria")}>
                      {t("defaultBadge")}
                    </Badge>
                  )}
                </div>
                <SetPrimaryChannelButton channelId={channel.id} isPrimary={channel.isPrimary} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
