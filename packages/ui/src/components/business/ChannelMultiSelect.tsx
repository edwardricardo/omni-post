"use client";

/**
 * @file ChannelMultiSelect.tsx
 * @description Smart-default + override channel selector. Renders one
 *              accessible fieldset/legend group per selected provider with the
 *              primary channel pre-checked (controlled by the parent), a
 *              `Default` badge labelled for assistive tech, an empty state
 *              with a link to the channels settings when a provider has no
 *              connected channels, and a deterministic default-selection
 *              helper consumers can call to seed `value`.
 * @component ChannelMultiSelect
 * @layer infrastructure
 */

import * as React from "react";
import { Checkbox } from "../checkbox.js";
import { Badge } from "../badge.js";
import { cn } from "../../lib/utils.js";

/**
 * Minimal channel shape consumed by the selector — kept in sync with
 * `apps/client/lib/hooks/useProjectChannels/types.ts` but redeclared here so
 * `packages/ui` stays free of cross-package imports.
 */
export interface ChannelMultiSelectChannel {
  id: string;
  name: string;
  platform: string;
  isPrimary: boolean;
}

export interface ChannelMultiSelectProps {
  /** Channel catalogue returned by `useProjectChannels(projectId)`. */
  channels: ChannelMultiSelectChannel[];
  /** Providers currently selected by the user (e.g. ["X", "INSTAGRAM"]). */
  selectedProviders: string[];
  /** Channel ids currently checked. Controlled by the parent. */
  value: string[];
  /** Fires whenever the user toggles any checkbox. */
  onChange: (channelIds: string[]) => void;
  /** Link target when a provider has no connected channels. */
  noChannelsHref?: string;
  /** Optional class name applied to the outer container. */
  className?: string;
  /** Optional id base used to derive checkbox ids deterministically. */
  idPrefix?: string;
  /** Optional label override per provider key (e.g. { X: "Twitter / X" }). */
  providerLabels?: Record<string, string>;
}

/**
 * @method computeDefaultChannelSelection
 * @description Returns the canonical default selection for the given channels
 *   and provider filter: one channel per selected provider, preferring the
 *   `isPrimary` flag, falling back to the first channel encountered. Stable
 *   ordering is guaranteed when `channels` is sorted (server returns
 *   `createdAt ASC`). Pure — safe to call inside `useMemo`.
 * @param channels - Full channel catalogue for the project.
 * @param selectedProviders - Providers the user has selected.
 * @returns Array of channel ids representing the default selection.
 */
export function computeDefaultChannelSelection(
  channels: ChannelMultiSelectChannel[],
  selectedProviders: string[]
): string[] {
  const ids: string[] = [];
  for (const provider of selectedProviders) {
    const candidates = channels.filter((c) => c.platform === provider);
    if (candidates.length === 0) continue;
    const primary = candidates.find((c) => c.isPrimary);
    ids.push((primary ?? candidates[0]!).id);
  }
  return ids;
}

/**
 * @component ChannelMultiSelect
 * @description Renders one fieldset-grouped checkbox list per selected provider
 *   following the WAI-ARIA Checkbox Pattern. The primary channel of each group
 *   carries a `Default` badge whose `aria-label` says "Default channel" so
 *   screen readers announce the affordance. Providers with zero connected
 *   channels render an empty state and a link to the channels settings.
 */
export function ChannelMultiSelect({
  channels,
  selectedProviders,
  value,
  onChange,
  noChannelsHref = "/dashboard/channels",
  className,
  idPrefix = "channel-select",
  providerLabels,
}: ChannelMultiSelectProps) {
  const valueSet = React.useMemo(() => new Set(value), [value]);

  const toggle = React.useCallback(
    (channelId: string) => {
      const next = new Set(value);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      onChange([...next]);
    },
    [value, onChange]
  );

  if (selectedProviders.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Select a platform first to choose which channel to publish to.
      </p>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {selectedProviders.map((provider) => {
        const groupChannels = channels.filter((c) => c.platform === provider);
        const legendId = `${idPrefix}-${provider}-legend`;
        const label = providerLabels?.[provider] ?? provider;

        return (
          <fieldset
            key={provider}
            aria-labelledby={legendId}
            className="rounded-md border border-border p-3"
          >
            <legend id={legendId} className="px-1 text-sm font-medium">
              {label}
            </legend>

            {groupChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No channels connected for {label}.{" "}
                <a href={noChannelsHref} className="font-medium underline">
                  Connect a channel
                </a>
                .
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {groupChannels.map((channel) => {
                  const checkboxId = `${idPrefix}-${channel.id}`;
                  const checked = valueSet.has(channel.id);
                  return (
                    <li key={channel.id} className="flex items-center gap-2">
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={() => toggle(channel.id)}
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex flex-1 items-center gap-2 text-sm cursor-pointer"
                      >
                        <span>{channel.name}</span>
                        {channel.isPrimary && (
                          <Badge
                            variant="secondary"
                            aria-label="Default channel"
                            className="ml-auto"
                          >
                            Default
                          </Badge>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
