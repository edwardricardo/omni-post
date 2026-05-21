/**
 * @file RecurringPostForm.tsx
 * @component RecurringPostForm
 * @description Form to create or edit a recurring post. Uses human-friendly recurrence picker,
 * channel selector, content variation radio, and optional end conditions.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useId } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "@packages/ui";
import { useProject } from "@/providers/ProjectProvider";
import { useProjectChannels } from "@/lib/hooks/useProjectChannels";
import { RecurrenceSelector } from "./RecurrenceSelector";
import {
  useCreateRecurringPost,
  useUpdateRecurringPost,
  type RecurringPost,
  type RecurringPostInput,
} from "@/hooks/api/useRecurringPosts";

interface RecurringPostFormProps {
  /** Existing post for edit mode; undefined = create mode */
  existing?: RecurringPost;
}

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const CONTENT_VARIATION_OPTIONS = [
  { value: "EXACT" as const },
  { value: "ROTATED" as const },
  { value: "AI_GENERATED" as const },
];

export function RecurringPostForm({ existing }: RecurringPostFormProps) {
  const t = useTranslations("scheduling.components");
  const router = useRouter();
  const { projectId } = useProject();
  const { data: channels = [] } = useProjectChannels(projectId);
  const createMutation = useCreateRecurringPost();
  const updateMutation = useUpdateRecurringPost();

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
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const nameId = useId();
  const timezoneId = useId();
  const maxOccurrencesId = useId();
  const endDateId = useId();
  const recurrenceHeadingId = useId();

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
    if (!name.trim()) next.name = t("formNameRequired");
    if (selectedChannels.length === 0) next.channels = t("formChannelsRequired");
    if (!cronExpression.trim()) next.cron = t("formCronRequired");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !projectId) return;

    const input: RecurringPostInput = {
      projectId,
      name: name.trim(),
      cronExpression,
      timezone,
      channels: selectedChannels,
      contentVariation,
      ...(maxOccurrences && { maxOccurrences: parseInt(maxOccurrences, 10) }),
      ...(endDate && { endDate: new Date(endDate).toISOString() }),
    };

    try {
      if (existing) {
        await updateMutation.mutateAsync({ id: existing.id, input });
        toast({ title: t("formSavedToast"), description: name.trim() });
      } else {
        await createMutation.mutateAsync(input);
        toast({ title: t("formCreatedToast"), description: name.trim() });
      }
      router.push("/dashboard/scheduling/recurring");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("formSaveError");
      setErrors({ submit: message });
      toast({
        title: existing ? t("formSaveFailedToast") : t("formCreateFailedToast"),
        description: message,
        variant: "destructive",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name */}
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium text-gray-700">
          {t("formNameLabel")}{" "}
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("formNamePlaceholder")}
          required
          aria-required="true"
          aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.name && (
          <p id={`${nameId}-error`} role="alert" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
      </div>

      {/* Recurrence */}
      <div>
        <span id={recurrenceHeadingId} className="block text-sm font-medium text-gray-700 mb-2">
          {t("formRecurrenceLabel")}{" "}
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        </span>
        <div
          role="group"
          aria-labelledby={recurrenceHeadingId}
          aria-describedby={errors.cron ? `${recurrenceHeadingId}-error` : undefined}
        >
          <RecurrenceSelector value={cronExpression} onChange={handleCronChange} />
        </div>
        {errors.cron && (
          <p id={`${recurrenceHeadingId}-error`} role="alert" className="mt-1 text-xs text-red-600">
            {errors.cron}
          </p>
        )}
      </div>

      {/* Timezone */}
      <div>
        <label htmlFor={timezoneId} className="block text-sm font-medium text-gray-700">
          {t("formTimezoneLabel")}
        </label>
        <select
          id={timezoneId}
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
      <fieldset
        className="border-0 p-0 m-0 min-w-0"
        aria-describedby={errors.channels ? "channels-error" : undefined}
      >
        <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
          {t("formChannelsLabel")}{" "}
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        </legend>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-500">{t("formNoChannels")}</p>
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
                  {ch.providerName} · {ch.accountName ?? ch.handle}
                </span>
              </label>
            ))}
          </div>
        )}
        {errors.channels && (
          <p id="channels-error" role="alert" className="mt-1 text-xs text-red-600">
            {errors.channels}
          </p>
        )}
      </fieldset>

      {/* Content variation */}
      <fieldset className="border-0 p-0 m-0 min-w-0">
        <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
          {t("formContentVariationLabel")}
        </legend>
        <div className="space-y-2">
          {CONTENT_VARIATION_OPTIONS.map((opt) => (
            <div key={opt.value} className="flex items-start gap-3">
              <input
                id={`content-variation-${opt.value}`}
                type="radio"
                name="contentVariation"
                value={opt.value}
                checked={contentVariation === opt.value}
                onChange={() => setContentVariation(opt.value)}
                className="mt-0.5 text-blue-600"
              />
              <label htmlFor={`content-variation-${opt.value}`} className="cursor-pointer">
                <span className="text-sm font-medium text-gray-900">
                  {t(`contentVariation.${opt.value}`)}
                </span>
                <p className="text-xs text-gray-500">{t(`contentVariationDesc.${opt.value}`)}</p>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Optional limits */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={maxOccurrencesId} className="block text-sm font-medium text-gray-700">
            {t("formMaxOccurrencesLabel")}
          </label>
          <input
            id={maxOccurrencesId}
            type="number"
            min="1"
            value={maxOccurrences}
            onChange={(e) => setMaxOccurrences(e.target.value)}
            placeholder={t("formMaxOccurrencesPlaceholder")}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor={endDateId} className="block text-sm font-medium text-gray-700">
            {t("formEndDateLabel")}
          </label>
          <input
            id={endDateId}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Submit error */}
      {errors.submit && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {errors.submit}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => router.push("/dashboard/scheduling/recurring")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? t("formSaving") : existing ? t("formSaveChanges") : t("formCreatePost")}
        </button>
      </div>
    </form>
  );
}
