/**
 * @file ChannelStatusBadge.tsx
 * @description Status pill rendered in the channels-table Status column.
 *              Order of precedence (highest first): expiredAt → the expiry date
 *              (amber); needsReauth → reconnect required (orange); not connected
 *              → disconnected (red); otherwise connected (green). Every label
 *              comes from the `channels.components.status` catalog keys.
 * @component ChannelStatusBadge
 * @layer infrastructure
 */

import { useLocale, useTranslations } from "next-intl";
import type { ProjectChannel } from "@/lib/hooks/useProjectChannels";
import { formatDay } from "./formatters";

/**
 * Status pill of one channel, labelled in the active UI locale; the expiry date, when shown, is
 * formatted in that locale too.
 */
export function ChannelStatusBadge({ channel }: { channel: ProjectChannel }) {
  const t = useTranslations("channels.components.status");
  const locale = useLocale();
  if (channel.expiredAt && !channel.isConnected) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
        {t("expiredOn", { date: formatDay(channel.expiredAt, locale) })}
      </span>
    );
  }
  if (channel.needsReauth) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
        {t("reconnectRequired")}
      </span>
    );
  }
  if (!channel.isConnected) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
        {t("disconnected")}
      </span>
    );
  }
  return (
    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
      {t("connected")}
    </span>
  );
}
