/**
 * @file ChannelsTable.tsx
 * @description Connected-channels table: avatar + provider name + handle
 *              + primary pill, status badge, this-month usage, last-used
 *              + connected timestamps, disconnect action. Empty state is
 *              rendered inline when the array is empty.
 * @component ChannelsTable
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import type { ProjectChannel } from "@/lib/hooks/useProjectChannels";
import { ChannelAvatar } from "./ChannelAvatar.js";
import { ChannelStatusBadge } from "./ChannelStatusBadge.js";
import { formatDate } from "./formatters.js";

interface ChannelsTableProps {
  channels: ProjectChannel[];
  selectedChannels: Set<string>;
  onSelectChannel: (channelId: string, selected: boolean) => void;
  onDisconnect: (channelId: string) => void;
}

export function ChannelsTable({
  channels,
  selectedChannels,
  onSelectChannel,
  onDisconnect,
}: ChannelsTableProps) {
  const t = useTranslations("channels");
  const columns = [
    { key: "channel", label: t("components.table.columns.channel") },
    { key: "status", label: t("components.table.columns.status") },
    { key: "usage", label: t("components.table.columns.usage") },
    { key: "lastUsed", label: t("components.table.columns.lastUsed") },
    { key: "connected", label: t("components.table.columns.connected") },
    { key: "actions", label: t("components.table.columns.actions") },
  ];
  return (
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden"
      role="region"
      aria-labelledby="channels-table"
    >
      <h3 id="channels-table" className="sr-only">
        {t("components.table.regionLabel")}
      </h3>
      <div className="overflow-x-auto">
        <table
          className="min-w-full divide-y divide-gray-200"
          role="table"
          aria-label={t("components.table.tableLabel")}
        >
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  aria-label={t("components.table.selectAll")}
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {channels.map((channel) => {
              const display = channel.accountName ?? channel.handle;
              return (
                <tr key={channel.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedChannels.has(channel.id)}
                      onChange={(e) => onSelectChannel(channel.id, e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label={t("components.table.selectChannel", { channel: display })}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <ChannelAvatar channel={channel} />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {channel.providerName}
                          {channel.isPrimary && (
                            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800 rounded">
                              {t("components.table.primary")}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">{display}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <ChannelStatusBadge channel={channel} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {t("components.table.postsThisMonth", {
                        count: channel.usage.postsThisMonth,
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(channel.lastUsedAt)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(channel.connectedAt)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => onDisconnect(channel.id)}
                        className="text-red-600 hover:text-red-900 text-sm focus:outline-hidden focus:underline"
                        aria-label={t("components.table.disconnectChannel", { channel: display })}
                      >
                        {t("components.table.disconnect")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {channels.length === 0 && (
        <div className="text-center py-12" role="status">
          <div className="text-gray-500">{t("components.table.emptyTitle")}</div>
          <p className="text-sm text-gray-400 mt-1">{t("components.table.emptyDescription")}</p>
        </div>
      )}
    </div>
  );
}
