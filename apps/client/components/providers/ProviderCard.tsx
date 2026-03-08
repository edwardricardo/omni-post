"use client";

/**
 * @file ProviderCard.tsx
 * @description Card displaying a social media provider's status, connection state,
 * and connect/disconnect actions with color-coded status indicators.
 */

import { Check, Clock, Construction, X } from "lucide-react";
import type { ProviderMetadata } from "@/lib/api/providers";
import { useProviderStatusColor, useProviderStatusLabel } from "@/lib/hooks/useProviders";
import { cn } from "@packages/ui";
import { Button } from "@packages/ui";

interface ProviderCardProps {
  provider: ProviderMetadata;
  connection?: {
    connected: boolean;
    accountName?: string;
  };
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSelect?: () => void;
}

export function ProviderCard({
  provider,
  connection,
  onConnect,
  onDisconnect,
  onSelect,
}: ProviderCardProps) {
  const statusColor = useProviderStatusColor(provider.status);
  const statusLabel = useProviderStatusLabel(provider.status);

  const StatusIcon =
    {
      active: Check,
      beta: Clock,
      coming_soon: Clock,
      maintenance: Construction,
    }[provider.status] || X;

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card p-6 transition-all hover:shadow-md",
        provider.status === "active" && "cursor-pointer hover:border-primary",
        provider.status !== "active" && "opacity-75"
      )}
      {...(provider.status === "active" && onSelect && { onClick: onSelect })}
    >
      {/* Status Badge */}
      <div className="absolute top-4 right-4">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            statusColor
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>

      {/* Provider Icon and Name */}
      <div className="mb-4 flex items-start gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${provider.color}20` }}
        >
          {/* Placeholder for icon - would use actual icon component or image */}
          <div className="h-8 w-8 rounded-sm" style={{ backgroundColor: provider.color }} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{provider.displayName}</h3>
          <p className="text-sm text-muted-foreground">{provider.description}</p>
        </div>
      </div>

      {/* Capabilities */}
      <div className="mb-4 space-y-2">
        <h4 className="text-sm font-medium">Capabilities</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(provider.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([capability]) => (
              <span
                key={capability}
                className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium"
              >
                {capability.replace("_", " ")}
              </span>
            ))}
        </div>
      </div>

      {/* Limits */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Max characters:</span>{" "}
          <span className="font-medium">{provider.limits.maxChars}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Max media:</span>{" "}
          <span className="font-medium">{provider.limits.maxMediaPerPost}</span>
        </div>
        {provider.limits.maxPostsPerThread && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Max thread length:</span>{" "}
            <span className="font-medium">{provider.limits.maxPostsPerThread} posts</span>
          </div>
        )}
      </div>

      {/* Connection Status and Actions */}
      {provider.status === "active" && (
        <div className="mt-4 pt-4 border-t">
          {connection?.connected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-green-600">
                  Connected as {connection.accountName}
                </span>
              </div>
              {onDisconnect && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDisconnect();
                  }}
                >
                  Disconnect
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Not connected</span>
              {onConnect && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnect();
                  }}
                >
                  Connect
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Coming Soon Overlay */}
      {provider.status === "coming_soon" && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-xs">
          <div className="text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="font-medium">Coming Soon</p>
          </div>
        </div>
      )}

      {/* Maintenance Overlay */}
      {provider.status === "maintenance" && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-xs">
          <div className="text-center">
            <Construction className="mx-auto h-8 w-8 text-yellow-600 mb-2" />
            <p className="font-medium text-yellow-600">Under Maintenance</p>
          </div>
        </div>
      )}
    </div>
  );
}
