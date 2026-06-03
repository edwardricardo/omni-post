"use client";

/**
 * @file BulkScheduleChannelPicker.tsx
 * @component BulkScheduleChannelPicker
 * @description Step 2 of the 2-phase bulk-scheduling flow: channel selection
 *              and confirm trigger. Renders a checkboxed list of the project's
 *              connected channels so the user can select target channels before
 *              confirming the bulk import. Each channel can be individually
 *              toggled — two same-provider channels are selectable independently.
 *              NO provider dropdown: channels are the canonical targeting unit.
 * @layer infrastructure
 */

import { useState } from "react";
import type { ProjectChannel } from "@/lib/hooks/useProjectChannels/types";

/** Props consumed by BulkScheduleChannelPicker. */
export interface BulkScheduleChannelPickerProps {
  /** Full project channel catalogue (all connected channels). */
  channels: ProjectChannel[];
  /** Controlled: channel IDs currently selected. */
  selectedChannelIds: string[];
  /** Fires when the user toggles any checkbox. */
  onChange: (channelIds: string[]) => void;
  /** Fires when the user clicks the Confirm button. */
  onConfirm: () => void;
  /** When true, the Confirm button shows a loading state and is disabled. */
  isConfirming: boolean;
}

/**
 * @component BulkScheduleChannelPicker
 * @description Renders one checkbox per connected channel (grouped by provider
 *   for readability). The Confirm button is disabled when no channels are
 *   selected or when a confirm is in progress.
 */
export function BulkScheduleChannelPicker({
  channels,
  selectedChannelIds,
  onChange,
  onConfirm,
  isConfirming,
}: BulkScheduleChannelPickerProps) {
  const [filter, setFilter] = useState("");

  const selectedSet = new Set(selectedChannelIds);

  const filteredChannels =
    filter.length > 0
      ? channels.filter(
          (c) =>
            c.name.toLowerCase().includes(filter.toLowerCase()) ||
            c.providerName.toLowerCase().includes(filter.toLowerCase())
        )
      : channels;

  // Group by provider for display
  const groups = filteredChannels.reduce<Record<string, ProjectChannel[]>>((acc, channel) => {
    const key = channel.providerName;
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(channel);
    return acc;
  }, {});

  function toggle(channelId: string) {
    const next = new Set(selectedChannelIds);
    if (next.has(channelId)) {
      next.delete(channelId);
    } else {
      next.add(channelId);
    }
    onChange([...next]);
  }

  const canConfirm = selectedChannelIds.length > 0 && !isConfirming;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-medium text-gray-900">Select target channels</h4>
        <p className="text-sm text-gray-500 mt-0.5">
          Each row will be scheduled to the selected channels.
        </p>
      </div>

      {channels.length === 0 ? (
        <p className="text-sm text-gray-500">
          No connected channels found.{" "}
          <a href="/dashboard/channels" className="font-medium text-blue-600 underline">
            Connect a channel
          </a>
          .
        </p>
      ) : (
        <>
          {channels.length > 5 && (
            <input
              type="text"
              placeholder="Filter channels..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter channels"
            />
          )}

          <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
            {Object.entries(groups).map(([providerName, groupChannels]) => (
              <fieldset key={providerName} className="rounded-md border border-gray-200 p-3">
                <legend className="px-1 text-sm font-medium text-gray-700">{providerName}</legend>
                <ul className="mt-2 space-y-2">
                  {groupChannels.map((channel) => {
                    const checkboxId = `bulk-channel-${channel.id}`;
                    const checked = selectedSet.has(channel.id);
                    return (
                      <li key={channel.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={checkboxId}
                          checked={checked}
                          onChange={() => toggle(channel.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          aria-label={channel.name}
                        />
                        <label
                          htmlFor={checkboxId}
                          className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-gray-900"
                        >
                          <span>{channel.name}</span>
                          {channel.isPrimary && (
                            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              Default
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {isConfirming
            ? "Confirming..."
            : `Confirm (${selectedChannelIds.length} channel${selectedChannelIds.length !== 1 ? "s" : ""})`}
        </button>
        <span className="text-sm text-gray-500">
          {selectedChannelIds.length} channel{selectedChannelIds.length !== 1 ? "s" : ""} selected
        </span>
      </div>
    </div>
  );
}
