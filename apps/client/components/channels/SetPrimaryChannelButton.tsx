"use client";

/**
 * @file SetPrimaryChannelButton.tsx
 * @description Inline action button that promotes a channel to primary for its
 *              (project, provider) pair. Disabled when the channel is already
 *              primary; surfaces success / error via toast notifications.
 * @component SetPrimaryChannelButton
 * @layer infrastructure
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button, toast } from "@packages/ui";
import { Star } from "lucide-react";
import { useSetPrimaryChannel } from "@/lib/hooks/useProjectChannels";

export interface SetPrimaryChannelButtonProps {
  channelId: string;
  isPrimary: boolean;
}

/**
 * @component SetPrimaryChannelButton
 * @description Renders a "Set as primary" / "Primary" button. Clicking issues
 *   the `PATCH /channels/:id/set-primary` request via `useSetPrimaryChannel`
 *   and emits a toast on success or failure. Already-primary channels show a
 *   disabled state so the affordance is clear.
 */
export function SetPrimaryChannelButton({ channelId, isPrimary }: SetPrimaryChannelButtonProps) {
  const t = useTranslations("channels.components");
  const setPrimary = useSetPrimaryChannel();

  const onClick = useCallback(() => {
    setPrimary.mutate(channelId, {
      onSuccess: () => {
        toast({ title: t("toastUpdated") });
      },
      onError: (err) => {
        toast({
          title: t("toastFailed"),
          description: err instanceof Error ? err.message : t("toastTryAgain"),
          variant: "destructive",
        });
      },
    });
  }, [channelId, setPrimary, t]);

  return (
    <Button
      variant={isPrimary ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={isPrimary || setPrimary.isPending}
      aria-pressed={isPrimary}
    >
      <Star className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
      {isPrimary ? t("primary") : setPrimary.isPending ? t("saving") : t("setAsPrimary")}
    </Button>
  );
}
