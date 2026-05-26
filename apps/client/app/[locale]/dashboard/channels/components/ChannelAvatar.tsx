/**
 * @file ChannelAvatar.tsx
 * @description Avatar element rendered next to a channel name. Falls
 *              back to a circle with the provider initial when the
 *              connected account has no profile image.
 * @component ChannelAvatar
 * @layer infrastructure
 */

import type { ProjectChannel } from "@/lib/hooks/useProjectChannels";

export function ChannelAvatar({ channel }: { channel: ProjectChannel }) {
  if (channel.profileImage) {
    return (
      <img src={channel.profileImage} alt="" className="w-8 h-8 rounded-full object-cover mr-3" />
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium mr-3 bg-gray-600"
      aria-hidden="true"
    >
      {channel.providerName.charAt(0)}
    </div>
  );
}
