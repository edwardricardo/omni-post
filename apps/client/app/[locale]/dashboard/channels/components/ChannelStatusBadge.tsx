/**
 * @file ChannelStatusBadge.tsx
 * @description Status pill rendered in the channels-table Status column.
 *              Order of precedence (highest first): expiredAt → "Expired on
 *              YYYY-MM-DD" (amber); needsReauth → "Reconnect required"
 *              (orange); not connected → "Disconnected" (red); otherwise
 *              "Connected" (green).
 * @component ChannelStatusBadge
 * @layer infrastructure
 */

import type { ProjectChannel } from "@/lib/hooks/useProjectChannels";
import { formatDay } from "./formatters.js";

export function ChannelStatusBadge({ channel }: { channel: ProjectChannel }) {
  if (channel.expiredAt && !channel.isConnected) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
        Expired on {formatDay(channel.expiredAt)}
      </span>
    );
  }
  if (channel.needsReauth) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
        Reconnect required
      </span>
    );
  }
  if (!channel.isConnected) {
    return (
      <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
        Disconnected
      </span>
    );
  }
  return (
    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
      Connected
    </span>
  );
}
