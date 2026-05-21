"use client";

/**
 * @file BrandVoiceForm.tsx
 * @component BrandVoiceForm
 * @description Form for creating and editing the Brand Voice profile for an account.
 *              Manages tone chip selection, system prompt textarea, and example post inputs.
 *              Submits via POST /api/backend/ai/brand-voice (upsert).
 * @layer infrastructure
 */

import React, { useState, useEffect, useCallback, useId } from "react";
import { useTranslations } from "next-intl";
import { useBrandVoice, useUpsertBrandVoice, useDeleteBrandVoice } from "@/hooks/api/useBrandVoice";

const TONE_OPTIONS = [
  "Professional",
  "Casual",
  "Witty",
  "Authoritative",
  "Friendly",
  "Inspirational",
  "Educational",
  "Conversational",
] as const;

const TONE_KEYS: Record<string, string> = {
  Professional: "professional",
  Casual: "casual",
  Witty: "witty",
  Authoritative: "authoritative",
  Friendly: "friendly",
  Inspirational: "inspirational",
  Educational: "educational",
  Conversational: "conversational",
};

const MAX_SYSTEM_PROMPT = 2000;
const MAX_EXAMPLES = 3;

interface BrandVoiceFormProps {
  accountId: string;
}

export function BrandVoiceForm({ accountId }: BrandVoiceFormProps) {
  const t = useTranslations("settings.components");
  const { data: existing, isLoading } = useBrandVoice(accountId);
  const upsertMutation = useUpsertBrandVoice();
  const deleteMutation = useDeleteBrandVoice();

  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedTones, setSelectedTones] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>(["", "", ""]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const nameId = useId();
  const systemPromptId = useId();
  const examplesIdPrefix = useId();
  const toneHeadingId = useId();

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setSystemPrompt(existing.systemPrompt);
      setSelectedTones(existing.tone);
      const filled = existing.examples.slice(0, MAX_EXAMPLES);
      const padded = [...filled, ...Array(MAX_EXAMPLES - filled.length).fill("")];
      setExamples(padded);
    }
  }, [existing]);

  const toggleTone = useCallback((tone: string) => {
    setSelectedTones((prev) =>
      prev.includes(tone) ? prev.filter((t) => t !== tone) : [...prev, tone]
    );
  }, []);

  const handleExampleChange = useCallback((index: number, value: string) => {
    setExamples((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !systemPrompt.trim()) return;

    setSaveStatus("saving");
    try {
      await upsertMutation.mutateAsync({
        accountId,
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        tone: selectedTones,
        examples: examples.filter((e) => e.trim().length > 0),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [accountId, name, systemPrompt, selectedTones, examples, upsertMutation]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    try {
      await deleteMutation.mutateAsync(accountId);
      setName("");
      setSystemPrompt("");
      setSelectedTones([]);
      setExamples(["", "", ""]);
      setDeleteConfirm(false);
    } catch {
      setDeleteConfirm(false);
    }
  }, [accountId, deleteConfirm, deleteMutation]);

  const promptLength = systemPrompt.length;
  const isSaving = saveStatus === "saving";
  const isDisabled = !name.trim() || !systemPrompt.trim() || isSaving;

  if (isLoading) {
    return (
      <div className="bg-white border rounded-lg p-6 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-lg p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{t("brandVoice.title")}</h3>
        <p className="text-sm text-gray-500 mt-1">{t("brandVoice.description")}</p>
      </div>

      {/* Name */}
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">
          {t("brandVoice.profileName")}{" "}
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("brandVoice.profileNamePlaceholder")}
          maxLength={100}
          required
          aria-required="true"
          className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* System Prompt */}
      <div>
        <label htmlFor={systemPromptId} className="block text-sm font-medium text-gray-700 mb-1">
          {t("brandVoice.systemPrompt")}{" "}
          <span aria-hidden="true" className="text-red-500">
            *
          </span>
        </label>
        <p className="text-xs text-gray-500 mb-2">{t("brandVoice.systemPromptHint")}</p>
        <textarea
          id={systemPromptId}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={t("brandVoice.systemPromptPlaceholder")}
          rows={6}
          maxLength={MAX_SYSTEM_PROMPT}
          required
          aria-required="true"
          className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p
          className={`text-xs text-right mt-1 ${
            promptLength >= MAX_SYSTEM_PROMPT * 0.9 ? "text-red-500" : "text-gray-400"
          }`}
        >
          {promptLength} / {MAX_SYSTEM_PROMPT}
        </p>
      </div>

      {/* Tone Chips */}
      <div>
        <span id={toneHeadingId} className="block text-sm font-medium text-gray-700 mb-2">
          {t("brandVoice.tone")}
        </span>
        <div role="group" aria-labelledby={toneHeadingId} className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((tone) => (
            <button
              key={tone}
              type="button"
              aria-pressed={selectedTones.includes(tone)}
              onClick={() => toggleTone(tone)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                selectedTones.includes(tone)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {t(`brandVoice.tones.${TONE_KEYS[tone]}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Example Posts */}
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-1">
          {t("brandVoice.examplePosts")}{" "}
          <span className="text-gray-400 font-normal">{t("brandVoice.examplePostsOptional")}</span>
        </span>
        <p className="text-xs text-gray-500 mb-2">{t("brandVoice.examplePostsHint")}</p>
        <div className="space-y-3">
          {examples.map((example, index) => {
            const exampleId = `${examplesIdPrefix}-${index}`;
            return (
              <textarea
                key={index}
                id={exampleId}
                aria-label={t("brandVoice.examplePostAria", { number: index + 1 })}
                value={example}
                onChange={(e) => handleExampleChange(index, e.target.value)}
                placeholder={t("brandVoice.examplePostPlaceholder", { number: index + 1 })}
                rows={3}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div>
          {existing && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleteMutation.isPending}
              className={`text-sm px-3 py-2 rounded-md border transition-colors ${
                deleteConfirm
                  ? "border-red-500 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600"
              }`}
            >
              {deleteMutation.isPending
                ? t("brandVoice.deleting")
                : deleteConfirm
                  ? t("brandVoice.confirmDelete")
                  : t("brandVoice.deleteProfile")}
            </button>
          )}
          {deleteConfirm && !deleteMutation.isPending && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="ml-2 text-sm text-gray-500 hover:text-gray-700"
            >
              {t("brandVoice.cancel")}
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saveStatus === "saved" && (
            <span className="text-sm text-green-600 font-medium">
              {t("brandVoice.savedSuccess")}
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-sm text-red-600 font-medium">{t("brandVoice.saveFailed")}</span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isDisabled}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving
              ? t("brandVoice.saving")
              : existing
                ? t("brandVoice.updateProfile")
                : t("brandVoice.saveProfile")}
          </button>
        </div>
      </div>
    </div>
  );
}
