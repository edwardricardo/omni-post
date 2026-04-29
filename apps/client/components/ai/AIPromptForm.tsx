"use client";

/**
 * @file AIPromptForm.tsx
 * @description Form component for configuring AI content generation, allowing users
 * to fill in template variables and adjust generation settings before triggering a run.
 */

import React, { useId } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import type { ContentTemplate, GenerationSettings } from "../../types/ai-content";

interface AIPromptFormProps {
  template: ContentTemplate;
  formData: Record<string, string>;
  settings: GenerationSettings;
  isGenerating: boolean;
  onFormDataChange: (data: Record<string, string>) => void;
  onSettingsChange: (settings: GenerationSettings) => void;
  onGenerate: () => void;
}

/**
 * @component AIPromptForm
 * @description Form for configuring AI content generation, allowing users to fill in
 * template variables and adjust generation settings before triggering a run.
 * @param props.template - Active template whose variables drive the form fields
 * @param props.settings - Generation parameters (tone, length, creativity, etc.)
 * @param props.isGenerating - Disables the form while a generation is in progress
 */
export function AIPromptForm({
  template,
  formData,
  settings,
  isGenerating,
  onFormDataChange,
  onSettingsChange,
  onGenerate,
}: AIPromptFormProps) {
  const handleInputChange = (name: string, value: string) => {
    onFormDataChange({ ...formData, [name]: value });
  };

  const handleSettingChange = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const variableIdPrefix = useId();

  return (
    <div className="border rounded-lg p-6 bg-gray-50">
      <h5 className="font-semibold text-gray-900 mb-4">Configure Template Variables</h5>

      {/* Template Variables */}
      <div className="space-y-4 mb-6">
        {template.variables.map((variable) => {
          const variableId = `${variableIdPrefix}-${variable.name}`;
          return (
            <div key={variable.name}>
              <label htmlFor={variableId} className="block text-sm font-medium text-gray-700 mb-1">
                {variable.label}{" "}
                {variable.required && (
                  <span aria-hidden="true" className="text-red-500">
                    *
                  </span>
                )}
              </label>
              {variable.type === "select" ? (
                <select
                  id={variableId}
                  value={formData[variable.name] || ""}
                  onChange={(e) => handleInputChange(variable.name, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  aria-required={variable.required}
                >
                  <option value="">{variable.placeholder}</option>
                  {variable.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={variableId}
                  type={variable.type}
                  value={formData[variable.name] || ""}
                  onChange={(e) => handleInputChange(variable.name, e.target.value)}
                  placeholder={variable.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  aria-required={variable.required}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Generation Settings */}
      <div className="pt-6 border-t">
        <h6 className="font-medium text-gray-900 mb-3">Generation Settings</h6>
        <div className="grid grid-cols-2 gap-4">
          {/* Creativity Slider */}
          <div>
            <label htmlFor="creativity-slider" className="block text-sm text-gray-700 mb-2">
              Creativity Level
            </label>
            <input
              id="creativity-slider"
              type="range"
              min="0"
              max="100"
              value={settings.creativity}
              onChange={(e) => handleSettingChange("creativity", Number(e.target.value))}
              className="w-full"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={settings.creativity}
            />
            <div className="text-xs text-gray-600 mt-1">{settings.creativity}%</div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.includeHashtags}
                onChange={(e) => handleSettingChange("includeHashtags", e.target.checked)}
                className="rounded text-purple-600 focus:ring-purple-500"
              />
              <span className="ml-2 text-sm text-gray-700">Include hashtags</span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.generateVariations}
                onChange={(e) => handleSettingChange("generateVariations", e.target.checked)}
                className="rounded text-purple-600 focus:ring-purple-500"
              />
              <span className="ml-2 text-sm text-gray-700">Generate variations</span>
            </label>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          aria-busy={isGenerating}
        >
          {isGenerating ? (
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="w-4 h-4" aria-hidden="true" />
          )}
          <span>{isGenerating ? "Generating..." : "Generate Content"}</span>
        </button>
      </div>
    </div>
  );
}
