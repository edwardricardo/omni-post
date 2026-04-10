/**
 * @file Pagination.tsx
 * @description Compact pagination bar with page navigation and per-page selector.
 * @layer presentation
 */
"use client";

import { useTranslations } from "next-intl";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  perPageOptions?: number[];
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  perPage,
  onPageChange,
  onPerPageChange,
  perPageOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const tc = useTranslations("common");
  const start = totalItems > 0 ? (page - 1) * perPage + 1 : 0;
  const end = Math.min(page * perPage, totalItems);

  return (
    <nav className="mt-3 flex items-center justify-between" aria-label="Pagination">
      <div className="text-xs text-[var(--text-tertiary)]" role="status" aria-live="polite">
        {totalItems > 0
          ? tc("showingRange", { from: start, to: end, total: totalItems })
          : tc("noData")}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor="per-page" className="text-xs text-[var(--text-tertiary)]">
            {tc("show")}
          </label>
          <select
            id="per-page"
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="h-6 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            {perPageOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="h-6 w-6 flex items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={tc("previous")}
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.354 3.354 5.707 8l4.647 4.646-.708.708L4.293 8l5.353-5.354.708.708z" />
            </svg>
          </button>
          <span className="text-xs text-[var(--text-secondary)] min-w-[4rem] text-center">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="h-6 w-6 flex items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={tc("next")}
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.646 3.354 10.293 8l-4.647 4.646.708.708L11.707 8 6.354 2.646l-.708.708z" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
