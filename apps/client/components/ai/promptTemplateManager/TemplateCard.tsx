/**
 * @file TemplateCard.tsx
 * @description Single tile in the templates grid. Surfaces name +
 *              "System" badge (for read-only entries), category, the
 *              prompt excerpt, the platform chips, and the tone tags.
 *              Renders a Delete button only on templates the current
 *              account owns.
 * @component TemplateCard
 * @layer infrastructure
 */

import type { AIPromptTemplateDto } from "@/hooks/api/useAIPromptTemplates";

interface TemplateCardProps {
  template: AIPromptTemplateDto;
  accountId: string;
  onDelete: (id: string) => void;
}

export function TemplateCard({ template, accountId, onDelete }: TemplateCardProps) {
  const isOwned = !template.isSystem && template.accountId === accountId;

  return (
    <div className="bg-white border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-gray-900 text-sm">{template.name}</h4>
            {template.isSystem && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                System
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">{template.category}</span>
        </div>
        {isOwned && (
          <button
            onClick={() => onDelete(template.id)}
            className="text-red-500 hover:text-red-700 text-xs shrink-0 focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
            aria-label={`Delete ${template.name}`}
          >
            Delete
          </button>
        )}
      </div>

      <p className="text-xs text-gray-600 line-clamp-3 break-words">{template.prompt}</p>

      <div className="flex flex-wrap gap-1">
        {template.platforms.map((p) => (
          <span
            key={p}
            className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-sm capitalize"
          >
            {p}
          </span>
        ))}
      </div>

      {template.tone.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.tone.map((t) => (
            <span key={t} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-sm">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
