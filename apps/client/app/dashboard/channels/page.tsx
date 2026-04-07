/**
 * @file page.tsx
 * @description Social media channels management page. Lists connected provider channels with
 * capability badges, usage stats, and allows disconnecting channels via mutation.
 */
"use client";

import { useState } from "react";
import { useChannels, useProviders, useDisconnectChannel } from "@/hooks/api/useChannels";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface Channel {
  id: string;
  providerId: string;
  providerName: string;
  accountName: string;
  accountId?: string;
  isActive: boolean;
  isConnected: boolean;
  lastUsed?: string;
  connectedAt: string;
  expiresAt?: string;
  capabilities: {
    publish: boolean;
    schedule: boolean;
    analytics: boolean;
    threading: boolean;
    stories?: boolean;
    reels?: boolean;
    carousel?: boolean;
  };
  usage: {
    postsThisMonth: number;
    lastPost?: string;
    rateLimitStatus: "OK" | "WARNING" | "LIMITED";
  };
}

interface Provider {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  status: "active" | "beta" | "coming_soon" | "maintenance";
  authType: "oauth" | "api_key" | "username_password";
  capabilities: Channel["capabilities"];
  description: string;
}

function ChannelsPageContent() {
  // Use TanStack Query hooks
  const {
    data: channels,
    isLoading: channelsLoading,
    error: channelsError,
    refetch: refetchChannels,
  } = useChannels();
  const { data: providers, isLoading: providersLoading, error: providersError } = useProviders();
  const disconnectChannelMutation = useDisconnectChannel();

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [blueskyAppPassword, setBlueskyAppPassword] = useState("");
  const [blueskyConnecting, setBlueskyConnecting] = useState(false);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);

  const isLoading = channelsLoading || providersLoading;
  const error = channelsError || providersError;

  const handleSelectChannel = (channelId: string, selected: boolean) => {
    const newSelected = new Set(selectedChannels);
    if (selected) {
      newSelected.add(channelId);
    } else {
      newSelected.delete(channelId);
    }
    setSelectedChannels(newSelected);
  };

  const handleConnectProvider = (provider: Provider) => {
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
    setBlueskyConnecting(true);
    setBlueskyError(null);
    try {
      const response = await fetch("/api/backend/channels/bluesky/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

  const handleDisconnectChannel = async (channelId: string) => {
    if (confirm("Are you sure you want to disconnect this channel?")) {
      try {
        await disconnectChannelMutation.mutateAsync(channelId);
      } catch {
        // Error already handled by mutation onError callback
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (channel: Channel) => {
    if (!channel.isConnected) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
          Disconnected
        </span>
      );
    }
    if (!channel.isActive) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
          Paused
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
        Active
      </span>
    );
  };

  const getRateLimitBadge = (status: Channel["usage"]["rateLimitStatus"]) => {
    const colors = {
      OK: "bg-green-100 text-green-800",
      WARNING: "bg-yellow-100 text-yellow-800",
      LIMITED: "bg-red-100 text-red-800",
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>
        {status}
      </span>
    );
  };

  const getProviderStatusBadge = (status: Provider["status"]) => {
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
  };

  // Focus trap for modal
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
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Channel Management</h1>
          <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
            <div className="text-lg text-red-600">Error: {error.message}</div>
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Channel Management</h1>
            <p className="text-gray-600 mt-2">Connect and manage your social media accounts</p>
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

        {/* Connected Channels */}
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
                      Capabilities
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
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {channels &&
                    channels.map((channel) => (
                      <tr key={channel.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedChannels.has(channel.id)}
                            onChange={(e) => handleSelectChannel(channel.id, e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            aria-label={`Select channel ${channel.accountName}`}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium mr-3"
                              style={{
                                backgroundColor: channel.providerId === "x" ? "#000000" : "#E4405F",
                              }}
                            >
                              {channel.providerName.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {channel.providerName}
                              </div>
                              <div className="text-sm text-gray-500">{channel.accountName}</div>
                              <div className="text-xs text-gray-400">
                                Connected {formatDate(channel.connectedAt)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {getStatusBadge(channel)}
                            {getRateLimitBadge(channel.usage.rateLimitStatus)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {channel.usage.postsThisMonth} posts this month
                          </div>
                          {channel.usage.lastPost && (
                            <div className="text-xs text-gray-500">
                              Last post: {formatDate(channel.usage.lastPost)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {channel.capabilities.publish && (
                              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-sm">
                                Publish
                              </span>
                            )}
                            {channel.capabilities.schedule && (
                              <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-sm">
                                Schedule
                              </span>
                            )}
                            {channel.capabilities.analytics && (
                              <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-sm">
                                Analytics
                              </span>
                            )}
                            {channel.capabilities.threading && (
                              <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded-sm">
                                Threading
                              </span>
                            )}
                            {channel.capabilities.carousel && (
                              <span className="px-2 py-1 text-xs bg-pink-100 text-pink-800 rounded-sm">
                                Carousel
                              </span>
                            )}
                            {channel.capabilities.reels && (
                              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-sm">
                                Reels
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {channel.lastUsed ? formatDate(channel.lastUsed) : "Never"}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex space-x-2">
                            <button
                              disabled
                              title="Coming soon"
                              className="text-blue-600 text-sm opacity-50 cursor-not-allowed focus:outline-hidden"
                              aria-label={`Test connection for ${channel.accountName} (coming soon)`}
                              aria-disabled="true"
                            >
                              Test
                            </button>
                            <button
                              disabled
                              title="Coming soon"
                              className="text-green-600 text-sm opacity-50 cursor-not-allowed focus:outline-hidden"
                              aria-label={`Settings for ${channel.accountName} (coming soon)`}
                              aria-disabled="true"
                            >
                              Settings
                            </button>
                            <button
                              onClick={() => handleDisconnectChannel(channel.id)}
                              className="text-red-600 hover:text-red-900 text-sm focus:outline-hidden focus:underline"
                              aria-label={`Disconnect ${channel.accountName}`}
                            >
                              Disconnect
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
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

        {/* Available Providers */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Providers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {providers &&
              providers.map((provider) => (
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

        {/* Connect Provider Modal */}
        {showConnectModal && selectedProvider && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={() => setShowConnectModal(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <div
              ref={modalRef}
              className="bg-white rounded-lg max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">Handle</label>
                      <input
                        type="text"
                        value={blueskyHandle}
                        onChange={(e) => setBlueskyHandle(e.target.value)}
                        placeholder="tuusuario.bsky.social"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        App Password
                      </label>
                      <input
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
                      // OAuth flow not yet implemented — requires redirect to provider OAuth URL
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
    </div>
  );
}

export default function Page() {
  return <ChannelsPageContent />;
}
