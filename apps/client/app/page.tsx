"use client";

import { useState } from "react";
import { useProviders, useAllProvidersHealth } from "@/lib/api";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { Button } from "@packages/ui";
import { RefreshCw, Activity, AlertCircle } from "lucide-react";
import { mapProvidersToMetadata } from "@/lib/utils/providerMapper";

export default function DashboardPage() {
  const [_selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const {
    data: providersData,
    isLoading: providersLoading,
    refetch: refetchProviders,
  } = useProviders();
  const {
    data: healthData,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useAllProvidersHealth();

  const providers = providersData?.providers || [];
  const providerMetadata = mapProvidersToMetadata(providers);

  const isLoading = providersLoading || healthLoading;

  const handleConnect = (_providerId: string) => {
    // OAuth flow requires provider-specific redirect — handled by auth routes when available
  };

  const handleDisconnect = (_providerId: string) => {
    // Disconnect requires token revocation API — handled by auth routes when available
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProvider(providerId);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Universal Client Dashboard</h1>
        <p className="text-muted-foreground">
          Manage your content across all social media platforms from one place
        </p>
      </div>

      {/* Health Status Bar */}
      {healthData && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Activity className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">System Health</p>
                <p className="text-sm text-muted-foreground">
                  {healthData.summary.healthy}/{healthData.summary.total} providers operational
                  {healthData.summary.avgLatency > 0 && (
                    <span> • Avg latency: {healthData.summary.avgLatency}ms</span>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchProviders();
                refetchHealth();
              }}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {healthData.summary.unhealthy > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-yellow-50 p-2 text-sm text-yellow-800">
              <AlertCircle className="h-4 w-4" />
              <span>
                {healthData.summary.unhealthy} provider{healthData.summary.unhealthy > 1 ? "s" : ""}{" "}
                experiencing issues
              </span>
            </div>
          )}
        </div>
      )}

      {/* Provider Grid */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Available Providers</h2>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 rounded-lg border bg-card animate-pulse" />
            ))}
          </div>
        ) : providerMetadata && providerMetadata.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {providerMetadata.map((provider) => {
              const _health = healthData?.providers.find((p) => p.id === provider.id);
              return (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onConnect={() => handleConnect(provider.id)}
                  onDisconnect={() => handleDisconnect(provider.id)}
                  onSelect={() => handleSelectProvider(provider.id)}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No providers available</p>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button className="w-full" size="lg">
            Create New Post
          </Button>
          <Button className="w-full" variant="outline" size="lg">
            View Analytics
          </Button>
          <Button className="w-full" variant="outline" size="lg">
            Manage Templates
          </Button>
        </div>
      </div>
    </div>
  );
}

function _cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}
