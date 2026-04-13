/**
 * @file PageHeader.tsx
 * @description Reusable page header with title, optional description, and action slot.
 *              Uses CSS custom-property design tokens for theme support.
 * @layer presentation
 */

import React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * @component PageHeader
 * @description Reusable page header with title, optional description, and an action slot
 *   for buttons or controls aligned to the right.
 * @param props.title - Main heading text
 * @param props.description - Optional subheading text
 * @param props.actions - Optional React node rendered in the right-aligned action area
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-3 border-b border-[var(--border-subtle)] pb-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
