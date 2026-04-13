/**
 * @file CrmSyncLog.tsx
 * @component CrmSyncLog
 * @description Sync history log for a CRM connection.
 * @layer client-components
 */

"use client";

import { useCrmSyncLogs } from "@/hooks/api/useCrm";

interface CrmSyncLogProps {
  platform: string;
}

const STATUS_STYLES = {
  COMPLETED: "bg-green-100 text-green-700",
  PARTIAL: "bg-yellow-100 text-yellow-700",
  FAILED: "bg-red-100 text-red-700",
  RUNNING: "bg-blue-100 text-blue-700",
} as const;

export function CrmSyncLog({ platform }: CrmSyncLogProps) {
  const { data: logs = [], isLoading } = useCrmSyncLogs(platform);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading sync history...</p>;
  }

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No syncs yet.</p>;
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Date</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-right px-3 py-2 font-medium">Contacts</th>
          </tr>
        </thead>
        <tbody>
          {logs.slice(0, 10).map((log) => (
            <tr key={log.id} className="border-t">
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(log.startedAt).toLocaleString()}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[log.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {log.status}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{log.contactsSynced}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
