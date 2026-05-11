/**
 * @file page.tsx
 * @description Admin dashboard for secret rotation status. Read-only table:
 *              one row per secret with last rotated, next due, days until due,
 *              and a status badge (OK / DUE_SOON / OVERDUE / UNKNOWN).
 * @component SecretsRotationPage
 * @layer infrastructure
 */
"use client";

import {
  useSecretRotationStatus,
  type SecretRotationStatusDTO,
} from "@/hooks/api/useSecretRotationStatus";
import { isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: SecretRotationStatusDTO["status"] }) {
  const variants: Record<
    SecretRotationStatusDTO["status"],
    { bg: string; fg: string; label: string }
  > = {
    OK: {
      bg: "var(--success-subtle)",
      fg: "var(--success)",
      label: "OK",
    },
    DUE_SOON: {
      bg: "var(--warning-subtle)",
      fg: "var(--warning)",
      label: "Due soon",
    },
    OVERDUE: {
      bg: "var(--error-subtle)",
      fg: "var(--error)",
      label: "Overdue",
    },
    UNKNOWN: {
      bg: "var(--bg-elevated)",
      fg: "var(--text-secondary)",
      label: "Unknown",
    },
  };
  const v = variants[status];
  return (
    <span
      className="inline-flex rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: v.bg, color: v.fg }}
    >
      {v.label}
    </span>
  );
}

const columns: Column<SecretRotationStatusDTO>[] = [
  { key: "secretName", header: "Secret" },
  { key: "category", header: "Category" },
  {
    key: "lastRotatedAt",
    header: "Last rotated",
    render: (s) => formatDate(s.lastRotatedAt),
  },
  {
    key: "nextRotationAt",
    header: "Next due",
    render: (s) => formatDate(s.nextRotationAt),
  },
  {
    key: "daysUntilDue",
    header: "Days remaining",
    render: (s) => (s.daysUntilDue === null ? "—" : String(s.daysUntilDue)),
  },
  {
    key: "status",
    header: "Status",
    render: (s) => <StatusBadge status={s.status} />,
  },
];

export default function SecretsRotationPage() {
  const { data, isLoading, error } = useSecretRotationStatus();

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Secret rotation status" />
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" label="Loading…" />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title="Secret rotation status" />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="Secret rotation status" />
        <div
          className="rounded-md border border-[var(--error)] bg-[var(--error-subtle)] p-3"
          role="alert"
        >
          <h3 className="font-medium text-[var(--error)]">Could not load rotation status</h3>
          <p className="mt-1 text-sm text-[var(--error)]">{getErrorMessage(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Secret rotation status"
        description="NIST cryptoperiod tracking for every platform secret. Append-only audit trail."
      />
      <DataTable
        columns={columns}
        data={data ?? []}
        emptyMessage="No secrets registered."
        rowKey={(s) => s.secretName}
      />
    </div>
  );
}
