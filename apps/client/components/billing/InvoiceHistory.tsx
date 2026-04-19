/**
 * @file InvoiceHistory.tsx
 * @description Invoice history table for client billing page. Shows paginated
 *   list of invoices with status badges, amounts, and action links.
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { ExternalLink, FileText, CreditCard } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@packages/ui";

import { useMyInvoices, useBillingPortal } from "@/hooks/api/useBilling";
import type { InvoiceDto } from "@/hooks/api/useBilling";

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/10 text-emerald-400",
  PAYMENT_FAILED: "bg-red-500/10 text-red-400",
  OPEN: "bg-amber-500/10 text-amber-400",
  DRAFT: "bg-zinc-500/10 text-zinc-400",
  VOID: "bg-zinc-500/10 text-zinc-400",
  UNCOLLECTIBLE: "bg-red-500/10 text-red-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${s} – ${e}`;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toLowerCase(),
  }).format(amount);
}

/**
 * @component InvoiceHistory
 * @description Paginated invoice history table with status badges and action links.
 */
export function InvoiceHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useMyInvoices(page, 10);
  const portalMutation = useBillingPortal();

  const invoices = data?.invoices ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 10));

  if (isLoading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="text-base font-semibold text-zinc-100 mb-4">Invoice History</h3>
        <div className="flex justify-center py-8 text-sm text-zinc-500">Loading invoices...</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h3 className="text-base font-semibold text-zinc-100 mb-4">Invoice History</h3>

      {invoices.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4 text-center">No invoices yet</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800">
                <TableHead className="text-zinc-400">Date</TableHead>
                <TableHead className="text-zinc-400">Period</TableHead>
                <TableHead className="text-zinc-400">Amount</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv: InvoiceDto) => (
                <TableRow key={inv.id} className="border-zinc-800">
                  <TableCell className="text-zinc-300 text-sm">
                    {formatDate(inv.createdAt)}
                  </TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {formatPeriod(inv.periodStart, inv.periodEnd)}
                  </TableCell>
                  <TableCell className="text-zinc-200 text-sm font-medium">
                    {formatAmount(inv.amountDue, inv.currency)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[inv.status] ?? "bg-zinc-700 text-zinc-300"}`}
                    >
                      {inv.status === "PAYMENT_FAILED" ? "Failed" : inv.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inv.hostedUrl && (
                        <a
                          href={inv.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                          title="View invoice"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View
                        </a>
                      )}
                      {inv.pdfUrl && (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                          title="Download PDF"
                        >
                          <FileText className="h-3 w-3" />
                          PDF
                        </a>
                      )}
                      {inv.status === "PAYMENT_FAILED" && (
                        <button
                          type="button"
                          onClick={() => portalMutation.mutate()}
                          disabled={portalMutation.isPending}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-zinc-800"
                        >
                          <CreditCard className="h-3 w-3" />
                          Update Payment
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
              <span>
                Showing {(page - 1) * 10 + 1}–{Math.min(page * 10, total)} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
