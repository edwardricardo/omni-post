/**
 * @file exportAccountsToCSV.ts
 * @description Exports selected accounts to a CSV file download.
 * @layer infrastructure
 */

import type { AccountSummary } from "@/lib/apiClient";

export function exportAccountsToCSV(accounts: AccountSummary[], selected: Set<string>) {
  const headers = ["ID", "Email", "Name", "Plan", "Status", "Created At", "Last Login"];
  const rows = accounts
    .filter((a) => selected.has(a.id))
    .map((a) => [
      a.id,
      a.email,
      a.name,
      a.plan.name,
      a.isActive ? "Active" : "Suspended",
      a.createdAt,
      a.lastLoginAt ?? "Never",
    ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounts-export-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
