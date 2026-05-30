"use client";

/**
 * @file SmartContentOptimizerSuggestions.tsx
 * @description Suggestions tab for the SmartContentOptimizer, displaying optimization
 * suggestions with priority badges, expected impact, and apply/dismiss actions.
 * @component SmartContentOptimizerSuggestions
 * @layer infrastructure
 */

import React from "react";
import { CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OptimizationSuggestion } from "./smartContentOptimizerUtils";
import { getPriorityColor } from "./smartContentOptimizerUtils";

interface SmartContentOptimizerSuggestionsProps {
  suggestions: OptimizationSuggestion[];
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
}

/**
 * @component SmartContentOptimizerSuggestions
 * @description Optimization suggestions tab displaying actionable recommendations with
 * priority badges, expected engagement impact, and apply/dismiss actions.
 * @param props.onApplySuggestion - Callback fired when the user applies a suggestion
 */
export function SmartContentOptimizerSuggestions({
  suggestions,
  onApplySuggestion,
}: SmartContentOptimizerSuggestionsProps) {
  const t = useTranslations("ai.components");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">
          {t("suggestions.title", { count: suggestions.length })}
        </h4>
        <div className="text-sm text-gray-600">
          {t("suggestions.potentialImprovement", {
            impact: suggestions.reduce((sum, s) => sum + s.expectedImpact, 0),
          })}
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="space-y-4">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className={`border-l-4 rounded-lg p-4 ${getPriorityColor(suggestion.priority)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        suggestion.priority === "high"
                          ? "bg-red-200 text-red-800"
                          : suggestion.priority === "medium"
                            ? "bg-yellow-200 text-yellow-800"
                            : "bg-green-200 text-green-800"
                      }`}
                    >
                      {suggestion.priority.toUpperCase()}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{suggestion.title}</span>
                    <span className="text-sm text-green-600 font-medium">
                      +{suggestion.expectedImpact}%
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{suggestion.description}</p>
                  {suggestion.currentValue && (
                    <div className="text-xs text-gray-600 mb-1">
                      <span className="font-medium">{t("suggestions.current")}</span>{" "}
                      {suggestion.currentValue}
                    </div>
                  )}
                  <div className="text-xs text-gray-600 mb-2">
                    <span className="font-medium">{t("suggestions.suggested")}</span>{" "}
                    {suggestion.suggestedValue}
                  </div>
                  <p className="text-xs text-gray-500 italic">{suggestion.reasoning}</p>
                </div>
                <div className="flex space-x-2 ml-4">
                  {suggestion.implementation === "automatic" && (
                    <button
                      onClick={() => onApplySuggestion(suggestion)}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                    >
                      {t("suggestions.apply")}
                    </button>
                  )}
                  <button className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-300">
                    {t("suggestions.dismiss")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{t("suggestions.emptyTitle")}</p>
          <p className="text-sm">{t("suggestions.emptyHint")}</p>
        </div>
      )}
    </div>
  );
}
