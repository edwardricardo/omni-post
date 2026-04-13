/**
 * @file DataTable.tsx
 * @description Generic data table with sticky header, loading skeleton, empty state,
 *              and optional row click handler. Uses CSS custom-property tokens.
 * @layer presentation
 */
"use client";

import React from "react";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  rowKey: (item: T) => string;
}

// ---------------------------------------------------------------------------
// Skeleton rows for loading state
// ---------------------------------------------------------------------------

function SkeletonRows<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, rowIndex) => (
        <tr key={`skeleton-${String(rowIndex)}`}>
          {columns.map((col) => (
            <td key={col.key} className="px-3 py-2.5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-elevated)]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Default cell renderer
// ---------------------------------------------------------------------------

function defaultRender<T>(item: T, key: string): React.ReactNode {
  const record = item as Record<string, unknown>;
  const val = record[key];
  if (val === null || val === undefined) return "-";
  return String(val);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * @component DataTable
 * @description Generic data table with sticky header, loading skeleton, empty state,
 *   and optional row click handler. Columns define rendering via a render function or auto-access by key.
 * @param props.columns - Column definitions with header text and optional custom render
 * @param props.data - Array of row items to display
 * @param props.rowKey - Function returning a unique key for each row item
 */
export function DataTable<T>({
  columns,
  data,
  isLoading = false,
  emptyMessage = "No data available",
  onRowClick,
  rowKey,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  "px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]",
                  col.className ?? "",
                ].join(" ")}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-[var(--border-subtle)]">
          {isLoading && <SkeletonRows columns={columns} />}

          {!isLoading && data.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-10 text-center text-sm text-[var(--text-secondary)]"
              >
                {emptyMessage}
              </td>
            </tr>
          )}

          {!isLoading &&
            data.map((item) => (
              <tr
                key={rowKey(item)}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                className={[
                  "bg-[var(--bg-surface)] transition-colors hover:bg-[var(--bg-elevated)]",
                  onRowClick ? "cursor-pointer" : "",
                ].join(" ")}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      "px-3 py-2.5 text-sm text-[var(--text-primary)]",
                      col.className ?? "",
                    ].join(" ")}
                  >
                    {col.render ? col.render(item) : defaultRender(item, col.key)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
