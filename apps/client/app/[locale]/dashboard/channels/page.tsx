/**
 * @file page.tsx
 * @description Channels management page for the active project. Composes
 *              the connected-channels table, the available-providers grid,
 *              and the Connect-provider dialog. Uses the consolidated
 *              `useProjectChannels` + `useDisconnectChannel` +
 *              `useConnectBluesky` hooks (TanStack Query v5 + canonical DTO).
 * @component ChannelsPage
 * @layer infrastructure
 */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderMetadata } from "@shared/types";
import { ConfirmDialog, toast } from "@packages/ui";
import { useDisconnectChannel, useProjectChannels } from "@/lib/hooks/useProjectChannels";
import { useProject } from "@/providers/ProjectProvider";
import { useProviders } from "@/lib/hooks/useProviders";
import { mapProvidersToMetadata } from "@/lib/utils/providerMapper";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PrimaryChannelsSection } from "@/components/channels/PrimaryChannelsSection";
import { AvailableProvidersGrid } from "./components/AvailableProvidersGrid.js";
import { ChannelsTable } from "./components/ChannelsTable.js";
import { ConnectProviderDialog } from "./components/ConnectProviderDialog.js";

function ChannelsPageContent() {
  const t = useTranslations("channels");
  const { projectId } = useProject();

  const {
    data: channels,
    isLoading: channelsLoading,
    error: channelsError,
    refetch: refetchChannels,
  } = useProjectChannels(projectId);

  const {
    providers: rawProviders,
    isLoading: providersLoading,
    error: providersError,
  } = useProviders();

  const providers = useMemo<ProviderMetadata[]>(
    () => mapProvidersToMetadata(rawProviders),
    [rawProviders]
  );
  const disconnectChannelMutation = useDisconnectChannel();

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [connectingProvider, setConnectingProvider] = useState<ProviderMetadata | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);

  const isLoading = channelsLoading || providersLoading;
  const error = channelsError || providersError;

  const handleSelectChannel = (channelId: string, selected: boolean) => {
    const next = new Set(selectedChannels);
    if (selected) next.add(channelId);
    else next.delete(channelId);
    setSelectedChannels(next);
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectTarget) return;
    try {
      await disconnectChannelMutation.mutateAsync(disconnectTarget);
      toast({ title: t("disconnectedTitle") });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("disconnectFailedFallback");
      toast({ title: t("disconnectFailedTitle"), description: message, variant: "destructive" });
    } finally {
      setDisconnectTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("pageTitle")}</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label={t("loadingChannels")} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isDev = process.env.NODE_ENV === "development";
    const displayMessage = isDev ? error.message || t("loadErrorDev") : t("loadErrorProd");
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("pageTitle")}</h1>
          <div className="flex justify-center items-center h-64" role="alert">
            <div className="text-lg text-red-600">{displayMessage}</div>
            <button
              onClick={() => refetchChannels()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={t("retryAriaLabel")}
            >
              {t("retryButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const projectName = channels?.[0]?.projectName ?? "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t("pageTitle")}</h1>
            <p className="text-gray-600 mt-2">
              {projectName ? t("subtitleWithProject", { projectName }) : t("subtitleDefault")}
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => refetchChannels()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={t("refreshAriaLabel")}
            >
              {t("refreshButton")}
            </button>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">{t("connectedChannels")}</h2>
          <ChannelsTable
            channels={channels ?? []}
            selectedChannels={selectedChannels}
            onSelectChannel={handleSelectChannel}
            onDisconnect={setDisconnectTarget}
          />
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">{t("availableProviders")}</h2>
          <AvailableProvidersGrid
            providers={providers}
            onConnect={(provider) => setConnectingProvider(provider)}
          />
        </div>

        {connectingProvider && (
          <ConnectProviderDialog
            provider={connectingProvider}
            projectId={projectId}
            open={connectingProvider !== null}
            onClose={() => setConnectingProvider(null)}
            onConnected={() => refetchChannels()}
          />
        )}
      </div>

      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        title={t("disconnectDialogTitle")}
        description={t("disconnectDialogDescription")}
        confirmLabel={t("disconnectButton")}
        variant="danger"
        onConfirm={handleConfirmDisconnect}
        loading={disconnectChannelMutation.isPending}
      />

      <div className="mt-8">
        <PrimaryChannelsSection />
      </div>
    </div>
  );
}

/**
 * @component Page
 * @description Manages connected social media channels with status, usage, and disconnect controls.
 */
export default function Page() {
  return <ChannelsPageContent />;
}
