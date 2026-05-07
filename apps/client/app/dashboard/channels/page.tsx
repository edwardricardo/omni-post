/**
 * @file page.tsx
 * @description Channels management page for the active project. Lists connected
 *              channels with provider, account, usage, and lifecycle metadata,
 *              and allows disconnecting via mutation. Uses the consolidated
 *              `useProjectChannels` hook (TanStack Query v5 + canonical DTO).
 * @component ChannelsPage
 * @layer infrastructure
 */
"use client";

import { useState, useId, useMemo } from "react";
import type { ProviderMetadata } from "@shared/types";
import { ConfirmDialog, toast } from "@packages/ui";
import {
  useProjectChannels,
  useDisconnectChannel,
  type ProjectChannel,
} from "@/lib/hooks/useProjectChannels";
import { useProject } from "@/providers/ProjectProvider";
import { useProviders } from "@/lib/hooks/useProviders";
import { mapProvidersToMetadata } from "@/lib/utils/providerMapper";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { PrimaryChannelsSection } from "@/components/channels/PrimaryChannelsSection";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ChannelStatusBadge({ channel }: { channel: ProjectChannel }) {
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

function ChannelAvatar({ channel }: { channel: ProjectChannel }) {
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

function getProviderStatusBadge(status: ProviderMetadata["status"]) {
  const colors = {
    active: "bg-green-100 text-green-800",
    beta: "bg-blue-100 text-blue-800",
    coming_soon: "bg-gray-100 text-gray-800",
    maintenance: "bg-orange-100 text-orange-800",
  };
  const labels = {
    active: "Active",
    beta: "Beta",
    coming_soon: "Coming Soon",
    maintenance: "Maintenance",
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

function ChannelsPageContent() {
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
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderMetadata | null>(null);
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [blueskyAppPassword, setBlueskyAppPassword] = useState("");
  const blueskyHandleId = useId();
  const blueskyAppPasswordId = useId();
  const [blueskyConnecting, setBlueskyConnecting] = useState(false);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);

  const isLoading = channelsLoading || providersLoading;
  const error = channelsError || providersError;

  const handleSelectChannel = (channelId: string, selected: boolean) => {
    const newSelected = new Set(selectedChannels);
    if (selected) newSelected.add(channelId);
    else newSelected.delete(channelId);
    setSelectedChannels(newSelected);
  };

  const handleConnectProvider = (provider: ProviderMetadata) => {
    setSelectedProvider(provider);
    setBlueskyHandle("");
    setBlueskyAppPassword("");
    setBlueskyError(null);
    setShowConnectModal(true);
  };

  const handleBlueskyConnect = async () => {
    if (!blueskyHandle.trim() || !blueskyAppPassword.trim()) {
      setBlueskyError("Handle y App Password son obligatorios.");
      return;
    }
    if (!projectId) {
      setBlueskyError("No active project — refresh the page and try again.");
      return;
    }
    setBlueskyConnecting(true);
    setBlueskyError(null);
    try {
      const response = await fetch("/api/backend/channels/bluesky/connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          identifier: blueskyHandle.trim(),
          appPassword: blueskyAppPassword.trim(),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setBlueskyError(data.error ?? "Handle o App Password inválido.");
        return;
      }
      setShowConnectModal(false);
      refetchChannels();
    } catch {
      setBlueskyError("Error de conexión. Intenta de nuevo.");
    } finally {
      setBlueskyConnecting(false);
    }
  };

  const handleDisconnectChannel = (channelId: string) => {
    setDisconnectTarget(channelId);
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectTarget) return;
    try {
      await disconnectChannelMutation.mutateAsync(disconnectTarget);
      toast({ title: "Channel disconnected" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect channel.";
      toast({ title: "Disconnect failed", description: message, variant: "destructive" });
    } finally {
      setDisconnectTarget(null);
    }
  };

  const modalRef = useFocusTrap<HTMLDivElement>(showConnectModal);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Channel Management</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label="Loading channels..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isDev = process.env.NODE_ENV === "development";
    const displayMessage = isDev
      ? error.message || "Failed to load channels"
      : "Failed to load channels. Please try again.";
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Channel Management</h1>
          <div className="flex justify-center items-center h-64" role="alert">
            <div className="text-lg text-red-600">{displayMessage}</div>
            <button
              onClick={() => refetchChannels()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading channels"
            >
              Retry
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
            <h1 className="text-3xl font-bold text-gray-900">Channel Management</h1>
            <p className="text-gray-600 mt-2">
              {projectName
                ? `Channels for ${projectName}`
                : "Connect and manage your social media accounts"}
            </p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => refetchChannels()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh channels"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Connected Channels</h2>
          <div
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            role="region"
            aria-labelledby="channels-table"
          >
            <h3 id="channels-table" className="sr-only">
              Connected channels table
            </h3>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-gray-200"
                role="table"
                aria-label="Connected channels"
              >
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label="Select all channels"
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Channel
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Usage
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Last Used
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Connected
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {channels?.map((channel) => {
                    const display = channel.accountName ?? channel.handle;
                    return (
                      <tr key={channel.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedChannels.has(channel.id)}
                            onChange={(e) => handleSelectChannel(channel.id, e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            aria-label={`Select channel ${display}`}
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
                                    PRIMARY
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
                            {channel.usage.postsThisMonth} posts this month
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
                              onClick={() => handleDisconnectChannel(channel.id)}
                              className="text-red-600 hover:text-red-900 text-sm focus:outline-hidden focus:underline"
                              aria-label={`Disconnect ${display}`}
                            >
                              Disconnect
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(!channels || channels.length === 0) && (
              <div className="text-center py-12" role="status">
                <div className="text-gray-500">No channels connected yet</div>
                <p className="text-sm text-gray-400 mt-1">
                  Connect your first social media account to get started
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Providers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {providers?.map((provider) => (
              <div
                key={provider.id}
                className="bg-white rounded-lg shadow-md overflow-hidden border hover:shadow-lg transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-medium mr-3"
                        style={{ backgroundColor: provider.color }}
                      >
                        {provider.displayName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {provider.displayName}
                        </h3>
                        <p className="text-sm text-gray-500">{provider.authType.toUpperCase()}</p>
                      </div>
                    </div>
                    {getProviderStatusBadge(provider.status)}
                  </div>

                  <p className="text-sm text-gray-600 mb-4">{provider.description}</p>

                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Capabilities</h4>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(provider.capabilities).map(
                          ([key, enabled]) =>
                            enabled && (
                              <span
                                key={key}
                                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm"
                              >
                                {key.charAt(0).toUpperCase() + key.slice(1)}
                              </span>
                            )
                        )}
                      </div>
                    </div>

                    <div className="pt-4">
                      {provider.status === "active" ? (
                        <button
                          onClick={() => handleConnectProvider(provider)}
                          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-sm hover:bg-blue-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          aria-label={`Connect ${provider.displayName}`}
                        >
                          Connect {provider.displayName}
                        </button>
                      ) : provider.status === "beta" ? (
                        <button
                          onClick={() => handleConnectProvider(provider)}
                          className="w-full px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-sm hover:bg-orange-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                          aria-label={`Connect ${provider.displayName} (Beta)`}
                        >
                          Connect (Beta)
                        </button>
                      ) : (
                        <button
                          disabled
                          className="w-full px-4 py-2 bg-gray-300 text-gray-500 text-sm font-medium rounded-sm cursor-not-allowed"
                          aria-label={`${provider.displayName} - ${provider.status === "coming_soon" ? "Coming Soon" : "Under Maintenance"}`}
                          aria-disabled="true"
                        >
                          {provider.status === "coming_soon" ? "Coming Soon" : "Maintenance"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {showConnectModal && selectedProvider && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <button
              type="button"
              aria-label="Close connect provider dialog"
              className="absolute inset-0 cursor-default"
              onClick={() => setShowConnectModal(false)}
            />
            <div ref={modalRef} className="relative bg-white rounded-lg max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 id="connect-modal-title" className="text-xl font-semibold text-gray-900">
                  Connect {selectedProvider.displayName}
                </h2>
                <button
                  onClick={() => setShowConnectModal(false)}
                  className="text-gray-400 hover:text-gray-600 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-sm"
                  aria-label="Close connect provider dialog"
                >
                  ✕
                </button>
              </div>

              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-4">
                  Connect your {selectedProvider.displayName} account to start publishing content.
                </p>

                {selectedProvider.id === "instagram" && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex">
                      <div className="text-blue-600 mr-2">ℹ️</div>
                      <div>
                        <p className="text-sm text-blue-800 font-medium">Instagram Requirements</p>
                        <p className="text-xs text-blue-700 mt-1">
                          You need a Business or Creator account connected to a Facebook Page.
                          Personal accounts are not supported by the Instagram Graph API.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {selectedProvider.id === "bluesky" && (
                  <div className="space-y-4">
                    <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                      <p className="text-sm text-sky-800 font-medium">App Password requerido</p>
                      <p className="text-xs text-sky-700 mt-1">
                        Bluesky usa App Passwords en lugar de OAuth. Genera una en{" "}
                        <a
                          href="https://bsky.app/settings/app-passwords"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-medium"
                        >
                          bsky.app/settings/app-passwords →
                        </a>
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor={blueskyHandleId}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Handle
                      </label>
                      <input
                        id={blueskyHandleId}
                        type="text"
                        value={blueskyHandle}
                        onChange={(e) => setBlueskyHandle(e.target.value)}
                        placeholder="tuusuario.bsky.social"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={blueskyAppPasswordId}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        App Password
                      </label>
                      <input
                        id={blueskyAppPasswordId}
                        type="password"
                        value={blueskyAppPassword}
                        onChange={(e) => setBlueskyAppPassword(e.target.value)}
                        placeholder="xxxx-xxxx-xxxx-xxxx"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    {blueskyError && <p className="text-sm text-red-600">{blueskyError}</p>}
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-700">Required Permissions:</h3>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {selectedProvider.id === "x" && (
                      <>
                        <li>• Read and write tweets</li>
                        <li>• Access user profile information</li>
                        <li>• Upload media</li>
                      </>
                    )}
                    {selectedProvider.id === "instagram" && (
                      <>
                        <li>• Manage Instagram content</li>
                        <li>• Access Instagram insights</li>
                        <li>• Publish photos and videos</li>
                        <li>• Access connected Facebook Pages</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowConnectModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-sm hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  aria-label="Cancel connection"
                >
                  Cancel
                </button>
                {selectedProvider.id === "bluesky" ? (
                  <button
                    onClick={handleBlueskyConnect}
                    disabled={blueskyConnecting}
                    className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-sm hover:bg-sky-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                    aria-label="Conectar cuenta de Bluesky"
                  >
                    {blueskyConnecting ? "Conectando..." : "Conectar Bluesky"}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setShowConnectModal(false);
                    }}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    aria-label={`Connect ${selectedProvider.displayName} account`}
                    title="OAuth flow — will redirect to provider authorization page"
                  >
                    Connect Account
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
        title="Disconnect channel?"
        description="Are you sure you want to disconnect this channel? Future posts will fail until reconnected."
        confirmLabel="Disconnect"
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
