/**
 * @file EmptyState.tsx
 * @description Reusable empty state component with icon, title, description, and optional CTA.
 * @layer infrastructure
 */
"use client";

import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@packages/ui";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

/**
 * @component EmptyState
 * @description Shows a centered empty state with icon, message, and optional action button.
 * @param props.icon - Lucide icon component
 * @param props.title - Main message
 * @param props.description - Supporting text
 * @param props.actionLabel - CTA button text
 * @param props.actionHref - CTA link destination
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>
      {actionLabel && actionHref && (
        <Button asChild size="sm">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}
