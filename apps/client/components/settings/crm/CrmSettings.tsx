/**
 * @file CrmSettings.tsx
 * @description Main CRM settings component with connection cards and sync logs.
 * @layer client-components
 */

"use client";

import { useState } from "react";
import { useCrmConnections } from "@/hooks/api/useCrm";
import { CrmConnectionCard } from "./CrmConnectionCard";
import { CrmSyncLog } from "./CrmSyncLog";

export function CrmSettings() {
  const { data: connections = [] } = useCrmConnections();
  const [showLogs, setShowLogs] = useState<string | null>(null);

  const hubspot = connections.find((c) => c.platform === "HUBSPOT");
  const salesforce = connections.find((c) => c.platform === "SALESFORCE");

  const hasAnyConnection = hubspot?.isActive || salesforce?.isActive;

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <CrmConnectionCard platform="HUBSPOT" connection={hubspot} />
        <CrmConnectionCard platform="SALESFORCE" connection={salesforce} />
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="text-sm font-medium mb-2">What gets synced</h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>Contacts synced from CRM to OmniPost</li>
          <li>Post published &rarr; logged as activity in CRM</li>
          <li>Campaign completed &rarr; logged in CRM</li>
          <li>Approval approved &rarr; logged in CRM</li>
        </ul>
      </div>

      {hasAnyConnection && (
        <div>
          <h3 className="text-sm font-medium mb-3">Sync History</h3>
          <div className="flex gap-2 mb-3">
            {hubspot?.isActive && (
              <button
                type="button"
                onClick={() => setShowLogs(showLogs === "hubspot" ? null : "hubspot")}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  showLogs === "hubspot"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                HubSpot
              </button>
            )}
            {salesforce?.isActive && (
              <button
                type="button"
                onClick={() => setShowLogs(showLogs === "salesforce" ? null : "salesforce")}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  showLogs === "salesforce"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                Salesforce
              </button>
            )}
          </div>
          {showLogs && <CrmSyncLog platform={showLogs} />}
        </div>
      )}
    </div>
  );
}
