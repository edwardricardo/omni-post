/**
 * @file RecurringPostCard.tsx
 * @component RecurringPostCard
 * @description Single recurring post row displaying schedule, channels, status, and actions.
 * @layer presentation
 */
"use client";

import { useState } from "react";
import cronstrue from "cronstrue";
import type { RecurringPost } from "@/hooks/api/useRecurringPosts";

interface RecurringPostCardProps {
  post: RecurringPost;
  onDeactivate: (id: string) => void;
  isDeactivating: boolean;
}

const CONTENT_VARIATION_LABELS: Record<RecurringPost["contentVariation"], string> = {
  EXACT: "Contenido exacto",
  ROTATED: "Rotación de biblioteca",
  AI_GENERATED: "IA genera cada vez",
};

function humanCron(expression: string): string {
  try {
    return cronstrue.toString(expression, { use24HourTimeFormat: true });
  } catch {
    return expression;
  }
}

function formatNextOccurrence(isoDate?: string): string {
  if (!isoDate) return "—";
  const date = new Date(isoDate);
  return date.toLocaleString("es", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function RecurringPostCard({ post, onDeactivate, isDeactivating }: RecurringPostCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDeactivateClick() {
    if (confirmDelete) {
      onDeactivate(post.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  }

  function handleCancel() {
    setConfirmDelete(false);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-gray-900">{post.name}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              post.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            {post.isActive ? "Activo" : "Inactivo"}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
          <span title={post.cronExpression}>{humanCron(post.cronExpression)}</span>
          <span>·</span>
          <span>
            {post.channels.length} canal{post.channels.length !== 1 ? "es" : ""}
          </span>
          <span>·</span>
          <span>{CONTENT_VARIATION_LABELS[post.contentVariation]}</span>
        </div>

        <div className="mt-1 text-xs text-gray-400">
          Próxima: {formatNextOccurrence(post.nextScheduledAt)}
          {post.maxOccurrences !== undefined && (
            <span className="ml-3">
              {post.occurrenceCount}/{post.maxOccurrences} ocurrencias
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {confirmDelete ? (
          <>
            <span className="text-sm text-red-600">¿Confirmar desactivación?</span>
            <button
              onClick={handleDeactivateClick}
              disabled={isDeactivating}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isDeactivating ? "..." : "Sí, desactivar"}
            </button>
            <button
              onClick={handleCancel}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </>
        ) : (
          post.isActive && (
            <button
              onClick={handleDeactivateClick}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Desactivar
            </button>
          )
        )}
      </div>
    </div>
  );
}
