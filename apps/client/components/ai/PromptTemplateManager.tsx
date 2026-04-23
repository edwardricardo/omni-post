"use client";

/**
 * @file PromptTemplateManager.tsx
 * @description Manages AI prompt templates. Lists system templates (read-only) and
 *   account templates (editable). Allows creating and deleting account-specific templates.
 * @layer infrastructure
 */

import React, { useState, useCallback } from "react";
import {
  useAIPromptTemplates,
  useCreateAIPromptTemplate,
  useDeleteAIPromptTemplate,
  type AIPromptTemplateDto,
  type CreateTemplateInput,
  type TemplateVariableDto,
} from "../../hooks/api/useAIPromptTemplates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptTemplateManagerProps {
  accountId: string;
}

interface CreateFormState {
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  tone: string;
}

const EMPTY_FORM: CreateFormState = {
  name: "",
  category: "Custom",
  platforms: [],
  prompt: "",
  tone: "",
};

const AVAILABLE_PLATFORMS = [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "snapchat",
  "telegram",
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  accountId,
  onDelete,
}: {
  template: AIPromptTemplateDto;
  accountId: string;
  onDelete: (id: string) => void;
}) {
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

// ---------------------------------------------------------------------------
// Create Form
// ---------------------------------------------------------------------------

function CreateTemplateForm({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
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

      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">Platforms *</span>
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
      </div>

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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * @component PromptTemplateManager
 * @description Displays and manages AI prompt templates for an account.
 */
export function PromptTemplateManager({ accountId }: PromptTemplateManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("All");

  const { data: templates = [], isLoading, error } = useAIPromptTemplates(accountId);
  const deleteMutation = useDeleteAIPromptTemplate();

  const categories = ["All", ...Array.from(new Set(templates.map((t) => t.category))).sort()];

  const filtered =
    categoryFilter === "All" ? templates : templates.filter((t) => t.category === categoryFilter);

  const systemTemplates = filtered.filter((t) => t.isSystem);
  const accountTemplates = filtered.filter((t) => !t.isSystem);

  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm("Delete this template? This cannot be undone.")) return;
      void deleteMutation.mutateAsync({ templateId: id, accountId });
    },
    [deleteMutation, accountId]
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
        role="alert"
      >
        Failed to load templates. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">AI Prompt Templates</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {templates.length} templates — {systemTemplates.length} system,{" "}
            {accountTemplates.length} custom
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            + New Template
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <CreateTemplateForm
          accountId={accountId}
          onClose={() => setShowCreateForm(false)}
          onCreated={() => setShowCreateForm(false)}
        />
      )}

      {/* Category filter */}
      {categories.length > 2 && (
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                categoryFilter === cat
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* System templates */}
      {systemTemplates.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            System Templates
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {systemTemplates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                accountId={accountId}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Account templates */}
      <section>
        <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
          Your Templates
        </h4>
        {accountTemplates.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-sm">No custom templates yet.</p>
            <p className="text-xs mt-1">Click &ldquo;+ New Template&rdquo; to create one.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accountTemplates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                accountId={accountId}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
