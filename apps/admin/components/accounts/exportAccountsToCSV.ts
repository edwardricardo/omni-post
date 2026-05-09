/**
 * @file exportAccountsToCSV.ts
 * @description Triggers a CSV download of selected accounts via the backend
 *   `/admin/accounts/export` endpoint. The server renders the CSV using the
 *   canonical `exportToCSV` utility (RFC 4180 + CSV-injection prevention),
 *   matching the same pattern used by billing/audit/webhook exports in admin.
 *   Replaces the prior client-side manual CSV builder which had a buggy
 *   escaping path for fields containing quotes, commas, or newlines.
 * @layer infrastructure
 */

export async function exportAccountsToCSV(selectedIds: Set<string>): Promise<void> {
  const ids = Array.from(selectedIds).join(",");
  const params = new URLSearchParams({ format: "csv" });
  if (ids.length > 0) params.set("ids", ids);

  const res = await fetch(`/api/backend/admin/accounts/export?${params.toString()}`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to export accounts: HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounts-export-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
