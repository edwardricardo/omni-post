"use client";

/**
 * @file SmartContentOptimizer.tsx
 * @description Orchestrator component for the Smart Content Optimizer. Manages analysis
 * state, delegates rendering to tab-specific sub-components, and coordinates with the
 * AI backend for content analysis and optimization.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Lightbulb,
  Hash,
  MessageCircle,
  Target,
  BarChart3,
  RefreshCw,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import type {
  ContentAnalysis,
  OptimizationSuggestion,
  HashtagAnalysis,
  ToneAnalysis,
  SmartContentOptimizerProps,
} from "./smartContentOptimizerUtils";
import {
  getScoreColor,
  adaptAnalysisResponse,
  adaptOptimizationResponse,
  adaptToneResponse,
  PLATFORM_TO_API_PROVIDER,
} from "./smartContentOptimizerUtils";
import { SmartContentOptimizerOverview } from "./SmartContentOptimizerOverview";
import { SmartContentOptimizerSuggestions } from "./SmartContentOptimizerSuggestions";
import { SmartContentOptimizerHashtags } from "./SmartContentOptimizerHashtags";
import { SmartContentOptimizerTone } from "./SmartContentOptimizerTone";
import { SmartContentOptimizerMetrics } from "./SmartContentOptimizerMetrics";

const API_URL = "/api/backend";

type ActiveTab = "overview" | "suggestions" | "hashtags" | "tone" | "metrics";

const SmartContentOptimizer: React.FC<SmartContentOptimizerProps> = ({
  content,
  platforms = ["twitter", "linkedin", "facebook"],
  targetAudience: _targetAudience = "general",
  brandVoice = "professional",
  onContentUpdate,
  onSuggestionApply,
  realTimeAnalysis = true,
  showAdvancedMetrics = false,
}) => {
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [hashtagAnalysis, setHashtagAnalysis] = useState<HashtagAnalysis[]>([]);
  const [toneAnalysis, setToneAnalysis] = useState<ToneAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [optimizedContent, setOptimizedContent] = useState(content);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  const analyzeContent = useCallback(
    async (textContent: string) => {
      if (!textContent.trim()) return;

      setIsAnalyzing(true);
      setAnalysisError(null);

      try {
        // Determine the primary platform for API request
        const primaryPlatform = platforms[0] ?? "twitter";
        const apiPlatform = PLATFORM_TO_API_PROVIDER[primaryPlatform] ?? primaryPlatform;

        const response = await fetch(`${API_URL}/ai/smart-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: textContent,
            platform: apiPlatform,
            ...(brandVoice !== "professional" && { brandVoice }),
            includeOptimization: true,
            includePrediction: true,
            includeVariations: false,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message =
            (errorBody as { error?: string } | null)?.error ?? `API error (${response.status})`;
          throw new Error(message);
        }

        const json = (await response.json()) as {
          ok?: boolean;
          data?: Record<string, unknown>;
        };

        if (!json.ok || !json.data) {
          throw new Error("Unexpected response format from AI service");
        }

        const apiData = json.data;
        const analysisData = (apiData.analysis ?? {}) as Record<string, unknown>;

        // Map API response through adapters
        setAnalysis(adaptAnalysisResponse(analysisData, textContent));

        // Build optimization suggestions from the optimization result
        const optimizationData = apiData.optimization as Record<string, unknown> | undefined;
        if (optimizationData) {
          setSuggestions(adaptOptimizationResponse(optimizationData));

          // Extract hashtag analysis from optimization data
          const hashtags = Array.isArray(optimizationData.hashtags)
            ? (optimizationData.hashtags as string[])
            : [];
          if (hashtags.length > 0) {
            setHashtagAnalysis(
              hashtags.map((tag, i) => ({
                hashtag: tag.startsWith("#") ? tag : `#${tag}`,
                relevanceScore: Math.max(10, 90 - i * 10),
                popularityIndex: Math.max(10, 80 - i * 8),
                competitionLevel: (i < 2 ? "low" : i < 4 ? "medium" : "high") as
                  | "low"
                  | "medium"
                  | "high",
                expectedReach: Math.max(1000, 50000 - i * 8000),
                trendingStatus: (i < 2 ? "rising" : "stable") as "rising" | "stable" | "declining",
                platforms: platforms,
              }))
            );
          } else {
            setHashtagAnalysis([]);
          }
        } else {
          setSuggestions([]);
          setHashtagAnalysis([]);
        }

        // Map tone analysis
        setToneAnalysis(adaptToneResponse(analysisData));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Content analysis failed";

        // Distinguish between "AI not configured" and transient failures
        if (message.includes("503") || message.includes("unavailable")) {
          setAnalysisError(
            "AI service is not available. Ensure at least one AI provider API key is configured on the server."
          );
        } else {
          setAnalysisError(message);
        }

        // Clear stale results on error
        setAnalysis(null);
        setSuggestions([]);
        setHashtagAnalysis([]);
        setToneAnalysis(null);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [platforms, brandVoice]
  );

  useEffect(() => {
    if (realTimeAnalysis && content) {
      const debounceTimer = setTimeout(() => {
        analyzeContent(content);
      }, 500);
      return () => clearTimeout(debounceTimer);
    }
  }, [content, realTimeAnalysis, analyzeContent]);

  const applySuggestion = useCallback(
    (suggestion: OptimizationSuggestion) => {
      let newContent = optimizedContent;

      switch (suggestion.type) {
        case "hashtags":
          newContent += ` ${suggestion.suggestedValue}`;
          break;
        case "emoji":
          newContent = suggestion.suggestedValue + " " + newContent;
          break;
        case "cta":
          newContent += `\n\n${suggestion.suggestedValue}`;
          break;
        default:
          break;
      }

      setOptimizedContent(newContent);
      onContentUpdate?.(newContent);
      onSuggestionApply?.(suggestion);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    },
    [optimizedContent, onContentUpdate, onSuggestionApply]
  );

  // Loading state
  if (isAnalyzing) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-center space-x-3 py-8">
          <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
          <div className="text-lg font-medium text-gray-900">Analyzing content with AI...</div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-300 rounded-sm w-3/4 mb-2"></div>
              <div className="h-8 bg-gray-300 rounded-sm"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (analysisError) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center py-8">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Analysis Failed</h3>
          <p className="text-gray-600 mb-4 max-w-md mx-auto">{analysisError}</p>
          <button
            onClick={() => analyzeContent(content)}
            disabled={!content.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Retry Analysis
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!analysis) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center py-8">
          <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Smart Content Optimizer</h3>
          <p className="text-gray-600 mb-4">Enter content to get optimization suggestions</p>
          <button
            onClick={() => analyzeContent(content)}
            disabled={!content.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Analyze Content
          </button>
        </div>
      </div>
    );
  }

  // Tab configuration
  const tabs = [
    { id: "overview" as const, label: "Overview", icon: BarChart3 },
    { id: "suggestions" as const, label: "Suggestions", icon: Lightbulb },
    { id: "hashtags" as const, label: "Hashtags", icon: Hash },
    { id: "tone" as const, label: "Tone Analysis", icon: MessageCircle },
    ...(showAdvancedMetrics
      ? [{ id: "metrics" as const, label: "Advanced Metrics", icon: Target }]
      : []),
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-linear-to-r from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Smart Content Optimizer</h3>
              <p className="text-sm text-gray-600">Content analysis and optimization</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div
              className={`px-3 py-1 rounded-full text-sm font-medium ${getScoreColor(analysis.overallScore)}`}
            >
              Overall Score: {Math.round(analysis.overallScore)}%
            </div>
            <button
              onClick={() => analyzeContent(content)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Re-analyze"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="p-6">
        {activeTab === "overview" && <SmartContentOptimizerOverview analysis={analysis} />}

        {activeTab === "suggestions" && (
          <SmartContentOptimizerSuggestions
            suggestions={suggestions}
            onApplySuggestion={applySuggestion}
          />
        )}

        {activeTab === "hashtags" && (
          <SmartContentOptimizerHashtags hashtagAnalysis={hashtagAnalysis} />
        )}

        {activeTab === "tone" &&
          (toneAnalysis ? (
            <SmartContentOptimizerTone toneAnalysis={toneAnalysis} />
          ) : (
            <div className="text-center py-8 text-gray-500">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              <p>Tone analysis data is not available for this content.</p>
              <p className="text-sm mt-1">Try re-analyzing with more text.</p>
            </div>
          ))}

        {activeTab === "metrics" && showAdvancedMetrics && (
          <SmartContentOptimizerMetrics platforms={platforms} />
        )}
      </div>
    </div>
  );
};

export default SmartContentOptimizer;
