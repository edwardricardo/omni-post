/**
 * @file CrmConnectionCard.tsx
 * @component CrmConnectionCard
 * @description Card for a single CRM platform connection (HubSpot or Salesforce).
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button } from "@packages/ui";
import { RefreshCw, Unplug, ExternalLink } from "lucide-react";
import { useDisconnectCrm, useSyncCrm } from "@/hooks/api/useCrm";
import type { CrmConnectionDto } from "@/hooks/api/useCrm";

interface CrmConnectionCardProps {
  platform: "HUBSPOT" | "SALESFORCE";
  connection: CrmConnectionDto | undefined;
}

const PLATFORM_INFO = {
  HUBSPOT: {
    name: "HubSpot",
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    connectUrl: "/api/backend/crm/hubspot/authorize",
  },
  SALESFORCE: {
    name: "Salesforce",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    connectUrl: "/api/backend/crm/salesforce/authorize",
  },
} as const;

export function CrmConnectionCard({ platform, connection }: CrmConnectionCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const disconnectMutation = useDisconnectCrm();
  const syncMutation = useSyncCrm();
  const info = PLATFORM_INFO[platform];

  const isConnected = connection?.isActive === true;

  const handleConnect = useCallback(async () => {
    const res = await fetch(info.connectUrl, { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; value?: { authorizationUrl: string } };
      if (data.ok && data.value?.authorizationUrl) {
        window.location.href = data.value.authorizationUrl;
      }
    }
  }, [info.connectUrl]);

  const handleDisconnect = useCallback(() => {
    disconnectMutation.mutate(platform.toLowerCase(), {
      onSuccess: () => setShowConfirm(false),
    });
  }, [platform, disconnectMutation]);

  const handleSync = useCallback(() => {
    syncMutation.mutate(platform.toLowerCase());
  }, [platform, syncMutation]);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`h-10 w-10 rounded-lg ${info.bgColor} flex items-center justify-center`}>
          <span className={`text-lg font-bold ${info.color}`}>{info.name[0]}</span>
        </div>
        <div>
          <h3 className="font-medium">{info.name}</h3>
          <p className="text-xs text-muted-foreground">
            {isConnected ? "Connected" : "Not connected"}
          </p>
        </div>
      </div>

      {!isConnected ? (
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            Sync contacts and log social activities in {info.name}.
          </p>
          <Button onClick={handleConnect} className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" />
            Connect {info.name}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {connection?.portalId && (
            <p className="text-xs text-muted-foreground">Portal: {connection.portalId}</p>
          )}
          {connection?.instanceUrl && (
            <p className="text-xs text-muted-foreground truncate">
              Instance: {connection.instanceUrl}
            </p>
          )}
          {connection?.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="flex-1"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`}
              />
              {syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(true)}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <Unplug className="h-4 w-4" />
            </Button>
          </div>

          {showConfirm && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm">
              <p className="font-medium text-red-800">Disconnect {info.name}?</p>
              <p className="text-red-700 text-xs mt-1">Contact sync will stop.</p>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={disconnectMutation.isPending}
                >
                  Disconnect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
