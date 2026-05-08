/**
 * @file CreateTemplateForm.tsx
 * @description Form for creating a new account-scoped prompt template.
 *              Owns its own draft state + per-field validation; on
 *              submit calls `useCreateAIPromptTemplate` and notifies
 *              the host via `onCreated`.
 * @component CreateTemplateForm
 * @layer infrastructure
 */

import { useCallback, useState } from "react";
import {
  useCreateAIPromptTemplate,
  type CreateTemplateInput,
  type TemplateVariableDto,
} from "@/hooks/api/useAIPromptTemplates";
import { AVAILABLE_PLATFORMS, EMPTY_FORM, type CreateFormState } from "./types";

interface CreateTemplateFormProps {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTemplateForm({ accountId, onClose, onCreated }: CreateTemplateFormProps) {
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateAIPromptTemplate();

  const togglePlatform = useCallback((platform: string) => {
    setForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform],
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!form.name.trim()) {
      setError("Template name is required");
      return;
    }
    if (!form.prompt.trim()) {
      setError("Prompt text is required");
      return;
    }
    if (form.platforms.length === 0) {
      setError("Select at least one platform");
      return;
    }

    const input: CreateTemplateInput = {
      accountId,
      name: form.name.trim(),
      category: form.category.trim() || "Custom",
      platforms: form.platforms,
      prompt: form.prompt.trim(),
      variables: [] as TemplateVariableDto[],
      tone: form.tone
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      await createMutation.mutateAsync(input);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create template");
    }
  }, [form, accountId, createMutation, onCreated]);

  return (
    <div className="bg-white border rounded-lg p-5 space-y-4">
      <h3 className="font-semibold text-gray-900">Create Template</h3>

      {error !== null && (
        <div
          className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor="tpl-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name *
        </label>
        <input
          id="tpl-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="My Custom Template"
          className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="tpl-category" className="block text-sm font-medium text-gray-700 mb-1">
          Category
        </label>
        <input
          id="tpl-category"
          type="text"
          value={form.category}
          onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
          placeholder="Custom"
          className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <fieldset className="border-0 p-0 m-0 min-w-0">
        <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">Platforms *</legend>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.platforms.includes(p)}
                onChange={() => togglePlatform(p)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs capitalize">{p}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="tpl-prompt" className="block text-sm font-medium text-gray-700 mb-1">
          Prompt *
        </label>
        <textarea
          id="tpl-prompt"
          value={form.prompt}
          onChange={(e) => setForm((p) => ({ ...p, prompt: e.target.value }))}
          placeholder="Write a compelling post about {{topic}} for {{platform}} audience..."
          rows={5}
          className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
        />
        <p className="text-xs text-gray-500 mt-1">
          Use {"{{"} variable {"}}"} for dynamic fields
        </p>
      </div>

      <div>
        <label htmlFor="tpl-tone" className="block text-sm font-medium text-gray-700 mb-1">
          Tone (comma-separated)
        </label>
        <input
          id="tpl-tone"
          type="text"
          value={form.tone}
          onChange={(e) => setForm((p) => ({ ...p, tone: e.target.value }))}
          placeholder="professional, engaging, friendly"
          className="w-full p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={() => void handleSubmit()}
          disabled={createMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {createMutation.isPending ? "Creating..." : "Create Template"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
