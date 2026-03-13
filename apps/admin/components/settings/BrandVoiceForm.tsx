"use client";

/**
 * @file BrandVoiceForm.tsx
 * @description Form for creating and editing the Brand Voice profile for an account.
 *              Manages tone chip selection, system prompt textarea, and example post inputs.
 *              Submits via POST /api/backend/ai/brand-voice (upsert).
 * @layer presentation
 */

import React, { useState, useEffect, useCallback } from "react";
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
];

const MAX_SYSTEM_PROMPT = 2000;
const MAX_EXAMPLES = 3;

interface BrandVoiceFormProps {
  accountId: string;
}

export function BrandVoiceForm({ accountId }: BrandVoiceFormProps) {
  const { data: existing, isLoading } = useBrandVoice(accountId);
  const upsertMutation = useUpsertBrandVoice();
  const deleteMutation = useDeleteBrandVoice();

  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedTones, setSelectedTones] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>(["", "", ""]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

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
        <h3 className="text-lg font-semibold text-gray-900">Brand Voice Profile</h3>
        <p className="text-sm text-gray-500 mt-1">
          This prompt is prepended to every AI content generation request for your account, ensuring
          consistent tone and style across all generated content.
        </p>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Profile Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main Brand Voice"
          maxLength={100}
          className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* System Prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          System Prompt <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Describe your brand tone, style, and key messaging guidelines. This is injected into every
          AI generation call.
        </p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={`Example: "You are a social media writer for a B2B SaaS company. Write in a professional yet approachable tone. Avoid jargon. Focus on value and outcomes. Use active voice. Keep sentences concise."`}
          rows={6}
          maxLength={MAX_SYSTEM_PROMPT}
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
        <label className="block text-sm font-medium text-gray-700 mb-2">Tone</label>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((tone) => (
            <button
              key={tone}
              type="button"
              onClick={() => toggleTone(tone)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                selectedTones.includes(tone)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {tone}
            </button>
          ))}
        </div>
      </div>

      {/* Example Posts */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Example Posts <span className="text-gray-400 font-normal">(optional, up to 3)</span>
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Paste examples of posts that represent your ideal brand voice. Used as reference by AI.
        </p>
        <div className="space-y-3">
          {examples.map((example, index) => (
            <textarea
              key={index}
              value={example}
              onChange={(e) => handleExampleChange(index, e.target.value)}
              placeholder={`Example post ${index + 1}...`}
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          ))}
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
                ? "Deleting..."
                : deleteConfirm
                  ? "Confirm Delete"
                  : "Delete Profile"}
            </button>
          )}
          {deleteConfirm && !deleteMutation.isPending && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="ml-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saveStatus === "saved" && (
            <span className="text-sm text-green-600 font-medium">Saved successfully</span>
          )}
          {saveStatus === "error" && (
            <span className="text-sm text-red-600 font-medium">Failed to save</span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isDisabled}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : existing ? "Update Profile" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
