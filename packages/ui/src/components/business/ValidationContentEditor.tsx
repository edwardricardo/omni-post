"use client";

import React, { useCallback, useMemo } from "react";
import {
  ContentEditorCore,
  type ContentEditorCoreProps,
  type ProviderConstraints,
  type ProviderSelectorRenderProps,
  type ValidationResult,
  type ContentEditorContent,
  validateContentForProvider,
} from "./ContentEditorCore";
import { cn } from "../../lib/utils";

export interface ValidationContentEditorProps
  extends Omit<ContentEditorCoreProps, "renderProviderSelector" | "customValidator"> {
  // Validation-specific props
  showValidationPanel?: boolean;
  showAdaptationSuggestions?: boolean;
  showPlatformPreviews?: boolean;
  validationClassName?: string;
  onValidationError?: (providerId: string, errors: ValidationResult["errors"]) => void;
}

/**
 * Validation-focused Content Editor
 * Extends ContentEditorCore with advanced validation display and platform-specific adaptation suggestions
 */
export function ValidationContentEditor({
  providers,
  selectedProviders: initialSelectedProviders = [],
  showValidationPanel = true,
  showAdaptationSuggestions = true,
  showPlatformPreviews = false,
  validationClassName,
  onValidationError,
  onValidationChange,
  ...baseProps
}: ValidationContentEditorProps) {
  const [validationResults, setValidationResults] = React.useState<
    Record<string, ValidationResult>
  >({});

  // Custom validator with error callbacks
  const customValidator = useCallback(
    (content: ContentEditorContent, targetProviders: ProviderConstraints[]) => {
      const results: Record<string, ValidationResult> = {};

      for (const provider of targetProviders) {
        const result = validateContentForProvider(content, provider);
        results[provider.id] = result;

        // Trigger error callback if validation fails
        if (!result.valid && onValidationError) {
          onValidationError(provider.id, result.errors);
        }
      }

      return results;
    },
    [onValidationError]
  );

  // Handle validation changes
  const handleValidationChange = useCallback(
    (results: Record<string, ValidationResult>) => {
      setValidationResults(results);
      onValidationChange?.(results);
    },
    [onValidationChange]
  );

  // Custom provider selector with validation status
  const renderProviderSelector = useCallback((props: ProviderSelectorRenderProps) => {
    return (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Target Platforms</h3>
        <div className="flex flex-wrap gap-3">
          {props.providers.map((provider) => {
            const validationResult = props.validationResults[provider.id];
            const hasErrors = validationResult && !validationResult.valid;
            const hasWarnings =
              validationResult && validationResult.errors.some((e) => e.severity === "warning");

            return (
              <button
                key={provider.id}
                onClick={() => props.onToggle(provider.id)}
                disabled={provider.isConnected === false}
                type="button"
                className={cn(
                  "px-4 py-2 rounded-lg font-medium transition-colors relative",
                  props.selectedProviders.includes(provider.id)
                    ? "bg-blue-500 text-white"
                    : provider.isConnected !== false
                      ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      : "bg-gray-50 text-gray-400 cursor-not-allowed"
                )}
              >
                {provider.displayName}
                {provider.isConnected === false && " (Not Connected)"}
                {props.selectedProviders.includes(provider.id) && validationResult && (
                  <span
                    className={cn(
                      "ml-2 text-xs",
                      validationResult.valid
                        ? "text-green-200"
                        : hasErrors
                          ? "text-red-200"
                          : hasWarnings
                            ? "text-yellow-200"
                            : ""
                    )}
                  >
                    {validationResult.valid ? "✓" : hasErrors ? "✗" : "⚠"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }, []);

  // Overall validation status
  const overallValid = useMemo(() => {
    return Object.values(validationResults).every((result) => result.valid);
  }, [validationResults]);

  return (
    <div className="validation-content-editor">
      <ContentEditorCore
        {...baseProps}
        providers={providers}
        selectedProviders={initialSelectedProviders}
        renderProviderSelector={renderProviderSelector}
        customValidator={customValidator}
        onValidationChange={handleValidationChange}
      />

      {/* Validation Panel */}
      {showValidationPanel && Object.keys(validationResults).length > 0 && (
        <div className={cn("mt-6", validationClassName)}>
          <h3 className="text-lg font-semibold mb-3">Platform Compatibility</h3>
          <div className="space-y-3">
            {Object.entries(validationResults).map(([providerId, result]) => {
              const provider = providers.find((p) => p.id === providerId);
              if (!provider) return null;

              return (
                <div
                  key={providerId}
                  className={cn(
                    "p-4 rounded-lg border",
                    result.valid ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">{provider.displayName}</h4>
                    <span
                      className={cn(
                        "px-2 py-1 rounded-sm text-xs font-medium",
                        result.valid ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      )}
                    >
                      {result.valid ? "Compatible" : "Needs Adaptation"}
                    </span>
                  </div>

                  {/* Validation Errors */}
                  {result.errors.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {result.errors.map((error, index) => (
                        <p
                          key={index}
                          className={cn(
                            "text-sm",
                            error.severity === "error"
                              ? "text-red-600"
                              : error.severity === "warning"
                                ? "text-yellow-600"
                                : "text-blue-600"
                          )}
                        >
                          {error.severity === "error" && "✗ "}
                          {error.severity === "warning" && "⚠ "}
                          {error.severity === "info" && "ℹ "}
                          {error.message}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Adaptation Suggestions */}
                  {showAdaptationSuggestions &&
                    result.suggestions &&
                    result.suggestions.length > 0 && (
                      <div className="mt-2 space-y-1 bg-white/50 rounded-sm p-2">
                        <p className="text-xs font-medium text-gray-700 mb-1">Suggestions:</p>
                        {result.suggestions.map((suggestion, index) => (
                          <p key={index} className="text-sm text-gray-600">
                            💡 {suggestion.message}
                          </p>
                        ))}
                      </div>
                    )}
                </div>
              );
            })}
          </div>

          {/* Overall Status */}
          <div
            className={cn(
              "mt-4 p-4 rounded-lg border",
              overallValid
                ? "border-green-300 bg-green-100 text-green-800"
                : "border-yellow-300 bg-yellow-100 text-yellow-800"
            )}
          >
            <p className="font-medium">
              {overallValid
                ? "✓ Content is compatible with all selected platforms"
                : "⚠ Content requires adaptation for some platforms"}
            </p>
          </div>
        </div>
      )}

      {/* Platform Previews */}
      {showPlatformPreviews && Object.keys(validationResults).length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">Platform Previews</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(validationResults).map(([providerId]) => {
              const provider = providers.find((p) => p.id === providerId);
              if (!provider) return null;

              return (
                <div key={providerId} className="border rounded-lg p-4 bg-card">
                  <h4 className="font-medium mb-2">{provider.displayName} Preview</h4>
                  <div className="bg-secondary/20 rounded-sm p-3 text-sm">
                    <p className="text-muted-foreground italic">Preview coming soon...</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export types
export type {
  ProviderConstraints,
  ContentEditorContent,
  ValidationResult,
} from "./ContentEditorCore";
