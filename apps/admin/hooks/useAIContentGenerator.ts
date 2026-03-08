/**
 * @file useAIContentGenerator.ts
 * @description Custom hook encapsulating all state and business logic for the AI content
 * generation workflow: template loading, form data management, generation settings,
 * content generation via the backend AI API, and clipboard operations.
 */

import { useState, useEffect, useCallback } from "react";
import type { ContentTemplate, GeneratedContent, GenerationSettings } from "../types/ai-content";
import { DEFAULT_CONTENT_TEMPLATES } from "../components/ai/ai-content-templates";
import { useAIContentGeneration } from "./api/useAIContentGeneration";

export type ActiveTab = "templates" | "generate" | "results";

interface UseAIContentGeneratorOptions {
  selectedTemplate?: string | undefined;
  targetPlatforms?: string[] | undefined;
  brandVoice?: string | undefined;
  onContentGenerated?: ((content: GeneratedContent[]) => void) | undefined;
}

interface UseAIContentGeneratorReturn {
  templates: ContentTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: (id: string) => void;
  selectedTemplate: ContentTemplate | undefined;
  formData: Record<string, string>;
  setFormData: (data: Record<string, string>) => void;
  generatedContent: GeneratedContent[];
  isGenerating: boolean;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  generationSettings: GenerationSettings;
  setGenerationSettings: (settings: GenerationSettings) => void;
  generateContent: () => Promise<void>;
  copyToClipboard: (text: string) => void;
}

export function useAIContentGenerator({
  selectedTemplate,
  targetPlatforms = ["twitter", "linkedin", "facebook"],
  brandVoice = "professional",
  onContentGenerated,
}: UseAIContentGeneratorOptions): UseAIContentGeneratorReturn {
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(selectedTemplate || "");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("templates");
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>({
    creativity: 70,
    platforms: targetPlatforms,
    brandVoice,
    tone: "balanced",
    length: "optimal",
    includeHashtags: true,
    includeMentions: false,
    includeEmojis: true,
    generateVariations: true,
    abTestMode: false,
  });

  // AI content generation via backend API (with client-side fallback)
  const aiMutation = useAIContentGeneration();

  useEffect(() => {
    setTemplates(DEFAULT_CONTENT_TEMPLATES);
    if (selectedTemplate) {
      setSelectedTemplateId(selectedTemplate);
    }
  }, [selectedTemplate]);

  const selectedTemplateObj = templates.find((t) => t.id === selectedTemplateId);

  const generateContent = useCallback(async () => {
    if (!selectedTemplateId) return;

    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) return;

    setActiveTab("generate");

    try {
      const content = await aiMutation.mutateAsync({
        template,
        formData,
        settings: generationSettings,
      });

      setGeneratedContent(content);
      setActiveTab("results");
      onContentGenerated?.(content);
    } catch {
      // Generation failed — stay on generate tab so user can retry
    }
  }, [selectedTemplateId, templates, formData, generationSettings, onContentGenerated, aiMutation]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  return {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate: selectedTemplateObj,
    formData,
    setFormData,
    generatedContent,
    isGenerating: aiMutation.isPending,
    activeTab,
    setActiveTab,
    generationSettings,
    setGenerationSettings,
    generateContent,
    copyToClipboard,
  };
}
