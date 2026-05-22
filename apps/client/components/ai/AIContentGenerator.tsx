"use client";

/**
 * @file AIContentGenerator.tsx
 * @description Top-level orchestrator for the AI content generation workflow.
 * Combines template selection, prompt configuration, generation preview,
 * and results display into a tabbed multi-step flow.
 *
 * Sub-components: AITemplateSelector, AIPromptForm, AIGenerationPreview, AIContentResults
 * State management: useAIContentGenerator hook
 */

import React from "react";
import { Wand2, Sparkles, Target, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GeneratedContent } from "../../types/ai-content";
import type { BrandVoice, ContentGoal } from "../../types/ai-content";
import { useAIContentGenerator } from "../../hooks/useAIContentGenerator";
import { AITemplateSelector } from "./AITemplateSelector";
import { AIPromptForm } from "./AIPromptForm";
import { AIGenerationPreview } from "./AIGenerationPreview";
import { AIContentResults } from "./AIContentResults";

interface AIContentGeneratorProps {
  selectedTemplate?: string;
  targetPlatforms?: string[];
  brandVoice?: BrandVoice;
  targetAudience?: string;
  contentGoal?: ContentGoal;
  onContentGenerated?: (content: GeneratedContent[]) => void;
  onSaveContent?: (content: GeneratedContent) => void;
  showAdvancedOptions?: boolean;
}

const TAB_CONFIG = [
  { id: "templates", labelKey: "generator.tabTemplates", icon: Target },
  { id: "generate", labelKey: "generator.tabGenerate", icon: Wand2 },
  { id: "results", labelKey: "generator.tabResults", icon: Eye },
] as const;

/**
 * @component AIContentGenerator
 * @description Orchestrates the AI content generation workflow through a tabbed multi-step
 * flow combining template selection, prompt configuration, generation preview, and results.
 * @param props.targetPlatforms - Social platforms to optimize generated content for
 * @param props.brandVoice - Brand voice configuration to maintain consistency
 * @param props.contentGoal - Goal driving the content generation (engagement, awareness, etc.)
 * @param props.onContentGenerated - Callback fired when AI generation completes with results
 */
const AIContentGenerator: React.FC<AIContentGeneratorProps> = ({
  selectedTemplate,
  targetPlatforms = ["twitter", "linkedin", "facebook"],
  brandVoice = "professional",
  targetAudience: _targetAudience = "general",
  contentGoal: _contentGoal = "engagement",
  onContentGenerated,
  onSaveContent,
  showAdvancedOptions: _showAdvancedOptions = false,
}) => {
  const t = useTranslations("ai.components");
  const {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate: currentTemplate,
    formData,
    setFormData,
    generatedContent,
    isGenerating,
    activeTab,
    setActiveTab,
    generationSettings,
    setGenerationSettings,
    generateContent,
    copyToClipboard,
  } = useAIContentGenerator({
    selectedTemplate,
    targetPlatforms,
    brandVoice,
    onContentGenerated,
  });

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-linear-to-r from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{t("generator.title")}</h3>
              <p className="text-sm text-gray-600">{t("generator.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-purple-600" aria-hidden="true" />
            <span className="text-sm text-gray-600">{t("generator.aiPowered")}</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6" aria-label={t("generator.stepsAriaLabel")}>
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                activeTab === tab.id
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
              aria-current={activeTab === tab.id ? "step" : undefined}
            >
              <tab.icon className="w-4 h-4" aria-hidden="true" />
              <span>{t(tab.labelKey)}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === "templates" && (
          <div className="space-y-6">
            <AITemplateSelector
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onTemplateSelect={setSelectedTemplateId}
            />

            {currentTemplate && (
              <AIPromptForm
                template={currentTemplate}
                formData={formData}
                settings={generationSettings}
                isGenerating={isGenerating}
                onFormDataChange={setFormData}
                onSettingsChange={setGenerationSettings}
                onGenerate={generateContent}
              />
            )}
          </div>
        )}

        {activeTab === "generate" && isGenerating && <AIGenerationPreview />}

        {activeTab === "results" && generatedContent.length > 0 && (
          <AIContentResults
            content={generatedContent}
            onCopy={copyToClipboard}
            {...(onSaveContent !== undefined && { onSave: onSaveContent })}
            onNewGeneration={() => setActiveTab("templates")}
          />
        )}

        {activeTab === "results" && generatedContent.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Wand2 className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
            <p>{t("generator.emptyTitle")}</p>
            <p className="text-sm">{t("generator.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export { AIContentGenerator };
