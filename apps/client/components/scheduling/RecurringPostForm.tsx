/**
 * @file RecurringPostForm.tsx
 * @component RecurringPostForm
 * @description Form to create or edit a recurring post. Uses human-friendly recurrence picker,
 * channel selector, content variation radio, and optional end conditions.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/providers/ProjectProvider";
import { useChannels } from "@/hooks/api/useChannels";
import { RecurrenceSelector } from "./RecurrenceSelector";
import type { RecurringPost } from "@/hooks/api/useRecurringPosts";

interface RecurringPostFormProps {
  /** Existing post for edit mode; undefined = create mode */
  existing?: RecurringPost;
}

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const CONTENT_VARIATION_OPTIONS = [
  {
    value: "EXACT" as const,
    label: "Contenido exacto",
    description: "Publica el mismo contenido en cada ocurrencia",
  },
  {
    value: "ROTATED" as const,
    label: "Rotación de biblioteca",
    description: "Rota entre múltiples variantes de contenido",
  },
  {
    value: "AI_GENERATED" as const,
    label: "IA genera cada vez",
    description: "La IA genera contenido nuevo en cada publicación",
  },
];

export function RecurringPostForm({ existing }: RecurringPostFormProps) {
  const router = useRouter();
  const { projectId } = useProject();
  const { data: channels = [] } = useChannels();

  const [name, setName] = useState(existing?.name ?? "");
  const [cronExpression, setCronExpression] = useState(existing?.cronExpression ?? "0 9 * * *");
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [selectedChannels, setSelectedChannels] = useState<string[]>(existing?.channels ?? []);
  const [contentVariation, setContentVariation] = useState<RecurringPost["contentVariation"]>(
    existing?.contentVariation ?? "EXACT"
  );
  const [maxOccurrences, setMaxOccurrences] = useState<string>(
    existing?.maxOccurrences?.toString() ?? ""
  );
  const [endDate, setEndDate] = useState(existing?.endDate ? existing.endDate.slice(0, 10) : "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleCronChange = useCallback((cron: string) => {
    setCronExpression(cron);
  }, []);

  function toggleChannel(id: string) {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "El nombre es obligatorio";
    if (selectedChannels.length === 0) next.channels = "Selecciona al menos un canal";
    if (!cronExpression.trim()) next.cron = "La expresión cron es obligatoria";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !projectId) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        projectId,
        name: name.trim(),
        cronExpression,
        timezone,
        channels: selectedChannels,
        contentVariation,
        ...(maxOccurrences && { maxOccurrences: parseInt(maxOccurrences, 10) }),
        ...(endDate && { endDate: new Date(endDate).toISOString() }),
      };

      const url = existing
        ? `/api/backend/recurring-posts/${existing.id}`
        : "/api/backend/recurring-posts";
      const method = existing ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({ error: "Error desconocido" }))) as {
          error?: string;
        };
        setErrors({ submit: data.error ?? "Error al guardar" });
        return;
      }

      router.push("/scheduling/recurring");
    } catch (_err) {
      setErrors({ submit: "Error de conexión. Intenta de nuevo." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Nombre <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Post semanal de LinkedIn"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
      </div>

      {/* Recurrence */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Recurrencia <span className="text-red-500">*</span>
        </label>
        <RecurrenceSelector value={cronExpression} onChange={handleCronChange} />
        {errors.cron && <p className="mt-1 text-xs text-red-600">{errors.cron}</p>}
      </div>

      {/* Timezone */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Zona horaria</label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      {/* Channels */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Canales <span className="text-red-500">*</span>
        </label>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-500">No hay canales conectados.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {channels.map((ch) => (
              <label
                key={ch.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                  selectedChannels.includes(ch.id)
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedChannels.includes(ch.id)}
                  onChange={() => toggleChannel(ch.id)}
                  className="rounded text-blue-600"
                />
                <span className="truncate">
                  {ch.providerName} · {ch.accountName}
                </span>
              </label>
            ))}
          </div>
        )}
        {errors.channels && <p className="mt-1 text-xs text-red-600">{errors.channels}</p>}
      </div>

      {/* Content variation */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Variación de contenido
        </label>
        <div className="space-y-2">
          {CONTENT_VARIATION_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="contentVariation"
                value={opt.value}
                checked={contentVariation === opt.value}
                onChange={() => setContentVariation(opt.value)}
                className="mt-0.5 text-blue-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                <p className="text-xs text-gray-500">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Optional limits */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Máximo de ocurrencias</label>
          <input
            type="number"
            min="1"
            value={maxOccurrences}
            onChange={(e) => setMaxOccurrences(e.target.value)}
            placeholder="Sin límite"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Fecha de fin</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Submit error */}
      {errors.submit && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errors.submit}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => router.push("/scheduling/recurring")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? "Guardando..." : existing ? "Guardar cambios" : "Crear publicación"}
        </button>
      </div>
    </form>
  );
}
