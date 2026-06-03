/**
 * @file QueueHealthPanel.tsx
 * @description Displays all 15 BullMQ queues with a color-coded health dot.
 *   Green = healthy, yellow = has delayed items, red = has failed items.
 *   Uses aggregate stats to derive the overall indicator when per-queue data
 *   is not yet available.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import type { QueueStats } from "@/hooks/api/useQueueManagement";

/** All BullMQ queue names from packages/adapters/queue-bullmq/src/constants.ts */
const QUEUE_NAMES = [
  "publish",
  "webhook-processing",
  "webhook-dead-letter",
  "dead-letter-queue",
  "integration-events",
  "failed-operations-dlq",
  "analytics-aggregation",
  "report-generation",
  "recurring-posts",
  "inbox-sync",
  "detect-repurpose",
  "generate-repurpose",
  "triage-inbox",
  "trend-radar",
  "auto-renewal",
] as const;

interface QueueHealthPanelProps {
  /** Aggregate queue statistics used to derive per-queue health colour. */
  stats: QueueStats | undefined;
}

/**
 * @function getOverallHealth
 * @description Derives a global health indicator from aggregate queue stats.
 * @returns "healthy" | "delayed" | "failed"
 */
function getOverallHealth(stats: QueueStats | undefined): "healthy" | "delayed" | "failed" {
  if (!stats) return "healthy";
  if (stats.failed > 0) return "failed";
  const delayed = stats.delayed ?? 0;
  if (delayed > 0) return "delayed";
  return "healthy";
}

const DOT_COLORS: Record<ReturnType<typeof getOverallHealth>, string> = {
  healthy: "bg-[var(--success)]",
  delayed: "bg-[var(--warning)]",
  failed: "bg-[var(--error)]",
};

/**
 * @component QueueHealthPanel
 * @description Renders a grid of all 15 BullMQ queues with color-coded health indicator dots.
 * @param props.stats - Aggregate queue statistics used to derive per-queue health status
 */
export function QueueHealthPanel({ stats }: QueueHealthPanelProps) {
  const tm = useTranslations("maintenance");
  const health = getOverallHealth(stats);

  const DOT_LABELS: Record<ReturnType<typeof getOverallHealth>, string> = {
    healthy: tm("healthLabels.healthy"),
    delayed: tm("healthLabels.delayed"),
    failed: tm("healthLabels.failed"),
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {QUEUE_NAMES.map((name) => (
        <div
          key={name}
          className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5"
        >
          <span
            className={["inline-block h-2.5 w-2.5 shrink-0 rounded-full", DOT_COLORS[health]].join(
              " "
            )}
            aria-label={DOT_LABELS[health]}
            role="status"
          />
          <span className="text-sm text-[var(--text-primary)] truncate">
            {tm(`queues.${name}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
