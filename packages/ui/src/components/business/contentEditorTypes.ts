/**
 * @file contentEditorTypes.ts
 * @description Shared interfaces, types, and pure utility functions for the ContentEditorCore
 *              component. Extracted to keep ContentEditorCore.tsx under 800 lines.
 * @layer infrastructure
 */
import type React from "react";

/**
 * Core Types - Shared across all variants
 */
export interface MediaFile {
  id: string;
  type: "image" | "video" | "gif";
  url: string;
  file?: File;
  width?: number;
  height?: number;
  alt?: string;
  metadata?: {
    size?: number;
    duration?: number;
  };
}

export interface ProviderConstraints {
  id: string;
  name: string;
  displayName: string;
  color?: string;
  maxChars: number;
  maxMediaFiles: number;
  allowedMediaTypes: string[];
  supportsThreading?: boolean;
  supportsScheduling?: boolean;
  supportsHashtags?: boolean;
  isConnected?: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  suggestions?: Array<{
    type: "truncate" | "split" | "optimize" | "format";
    message: string;
    action?: string;
  }>;
}

export interface ContentEditorContent {
  text: string;
  title?: string;
  tags?: string[];
  media?: MediaFile[];
}

/**
 * Feature Flags Configuration
 */
export interface ContentEditorCoreFeatures {
  richText?: boolean; // Use TipTap vs textarea (future enhancement)
  media?: boolean; // Enable media upload
  templates?: boolean; // Enable template selector (wrapper responsibility)
  scheduling?: boolean; // Enable schedule picker (wrapper responsibility)
  validation?: boolean; // Enable validation panel
  collaboration?: boolean; // Enable collaborative editing (wrapper responsibility)
  analytics?: boolean; // Enable analytics (admin-specific)
  advancedValidation?: boolean; // Enhanced validation (admin-specific)
  autoSave?: boolean; // Enable auto-save (wrapper responsibility)
  toolbar?: boolean; // Show formatting toolbar
  characterCount?: boolean; // Show character count
  providerSelection?: boolean; // Show provider selector
  dragAndDrop?: boolean; // Enable drag and drop
}

export interface ContentEditorCoreProps {
  // Content
  initialContent?: string;
  initialTitle?: string;
  initialTags?: string[];
  initialMedia?: MediaFile[];

  // Provider Configuration
  providers: ProviderConstraints[];
  selectedProviders?: string[];
  onProviderSelectionChange?: (providerIds: string[]) => void;

  // Callbacks
  onContentChange?: (content: ContentEditorContent) => void;
  onMediaAdd?: (files: File[]) => void;
  onMediaRemove?: (mediaId: string) => void;
  onValidationChange?: (results: Record<string, ValidationResult>) => void;
  onSave?: (content: ContentEditorContent) => Promise<void>;
  onPublish?: (content: ContentEditorContent, providers: string[]) => Promise<void>;

  // Feature Flags
  features?: ContentEditorCoreFeatures;

  // Options
  className?: string;
  placeholder?: string;
  validateOnChange?: boolean;
  customValidator?: (
    content: ContentEditorContent,
    providers: ProviderConstraints[]
  ) => Record<string, ValidationResult>;

  // Render Props (for advanced customization)
  renderToolbar?: (props: ToolbarRenderProps) => React.ReactNode;
  renderProviderSelector?: (props: ProviderSelectorRenderProps) => React.ReactNode;
  renderMediaPreview?: (props: MediaPreviewRenderProps) => React.ReactNode;
  renderCharacterCount?: (props: CharacterCountRenderProps) => React.ReactNode;
  renderValidationPanel?: (props: ValidationPanelRenderProps) => React.ReactNode;
}

export interface ToolbarRenderProps {
  onBold?: () => void;
  onItalic?: () => void;
  onMediaUpload: () => void;
  onEmojiPicker?: () => void;
  isBold?: boolean;
  isItalic?: boolean;
}

export interface ProviderSelectorRenderProps {
  providers: ProviderConstraints[];
  selectedProviders: string[];
  onToggle: (providerId: string) => void;
  validationResults: Record<string, ValidationResult>;
}

export interface MediaPreviewRenderProps {
  media: MediaFile[];
  onRemove: (mediaId: string) => void;
  maxMediaCount: number;
  onAddMore: () => void;
}

export interface CharacterCountRenderProps {
  currentCount: number;
  maxCount: number;
  percentage: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
}

export interface ValidationPanelRenderProps {
  validationResults: Record<string, ValidationResult>;
  providers: ProviderConstraints[];
  showAdaptationSuggestions?: boolean;
}

/**
 * Core Validation Logic - Shared utility functions
 */
export const validateContentForProvider = (
  content: ContentEditorContent,
  provider: ProviderConstraints
): ValidationResult => {
  const errors: ValidationError[] = [];
  const suggestions: ValidationResult["suggestions"] = [];

  // Text length validation
  const textLength = content.text.length;
  if (textLength > provider.maxChars) {
    errors.push({
      field: "text",
      message: `Text exceeds ${provider.maxChars} character limit (${textLength} chars)`,
      severity: "error",
    });

    suggestions.push({
      type: "truncate",
      message: `Reduce by ${textLength - provider.maxChars} characters`,
      action: "truncate_text",
    });

    if (provider.supportsThreading) {
      suggestions.push({
        type: "split",
        message: "Split into thread",
        action: "create_thread",
      });
    }
  } else if (textLength > provider.maxChars * 0.9) {
    errors.push({
      field: "text",
      message: `Approaching character limit (${textLength}/${provider.maxChars})`,
      severity: "warning",
    });
  }

  // Media count validation
  const mediaCount = content.media?.length || 0;
  if (mediaCount > provider.maxMediaFiles) {
    errors.push({
      field: "media",
      message: `Too many media files (${mediaCount}/${provider.maxMediaFiles})`,
      severity: "error",
    });

    suggestions.push({
      type: "optimize",
      message: `Remove ${mediaCount - provider.maxMediaFiles} media files`,
      action: "remove_media",
    });
  }

  // Media type validation
  if (content.media) {
    const unsupportedMedia = content.media.filter(
      (media) => !provider.allowedMediaTypes.includes(`${media.type}/*`)
    );

    if (unsupportedMedia.length > 0) {
      const types = unsupportedMedia.map((m) => m.type).join(", ");
      errors.push({
        field: "media",
        message: `Unsupported media types: ${types}`,
        severity: "error",
      });

      suggestions.push({
        type: "format",
        message: `Convert to supported formats: ${provider.allowedMediaTypes.join(", ")}`,
        action: "convert_media",
      });
    }
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
    suggestions,
  };
};

/**
 * Utility: Calculate character limits across providers
 */
export const getMinCharLimit = (providers: ProviderConstraints[]): number => {
  if (providers.length === 0) return 280; // Default
  return Math.min(...providers.map((p) => p.maxChars));
};

export const getMinMediaLimit = (providers: ProviderConstraints[]): number => {
  if (providers.length === 0) return 4; // Default
  return Math.min(...providers.map((p) => p.maxMediaFiles));
};

/**
 * Utility: Debounce function
 */
export const debounce = <T extends (...args: never[]) => void>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};
