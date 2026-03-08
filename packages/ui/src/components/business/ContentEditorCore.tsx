"use client";

import React from "react";
import { cn } from "../../lib/utils";
import type {
  MediaFile,
  ContentEditorCoreProps,
  ContentEditorCoreFeatures,
} from "./contentEditorTypes";
import { useContentEditor } from "./useContentEditor";

// Re-export all types and utilities from contentEditorTypes for backward compatibility.
// Consumers importing from "./ContentEditorCore" will continue to work unchanged.
export type {
  MediaFile,
  ProviderConstraints,
  ValidationError,
  ValidationResult,
  ContentEditorContent,
  ContentEditorCoreFeatures,
  ContentEditorCoreProps,
  ToolbarRenderProps,
  ProviderSelectorRenderProps,
  MediaPreviewRenderProps,
  CharacterCountRenderProps,
  ValidationPanelRenderProps,
} from "./contentEditorTypes";

export {
  validateContentForProvider,
  getMinCharLimit,
  getMinMediaLimit,
  debounce,
} from "./contentEditorTypes";

// Re-export the hook for direct consumers
export { useContentEditor } from "./useContentEditor";
export type { UseContentEditorOptions, UseContentEditorReturn } from "./useContentEditor";

/**
 * ContentEditorCore Component
 *
 * Provides core functionality for content editing with provider validation and feature flags.
 * State management is delegated to the useContentEditor hook.
 */
export function ContentEditorCore({
  initialContent = "",
  initialTitle = "",
  initialTags = [],
  initialMedia = [],
  providers,
  selectedProviders: initialSelectedProviders = [],
  onProviderSelectionChange,
  onContentChange,
  onMediaAdd,
  onMediaRemove,
  onValidationChange,
  onSave,
  onPublish: _onPublish,
  features = {},
  className,
  placeholder = "What's on your mind?",
  validateOnChange = true,
  customValidator,
  renderToolbar,
  renderProviderSelector,
  renderMediaPreview,
  renderCharacterCount,
  renderValidationPanel,
}: ContentEditorCoreProps) {
  // Default feature flags
  const enabledFeatures: Required<ContentEditorCoreFeatures> = {
    richText: false,
    media: true,
    templates: false,
    scheduling: false,
    validation: true,
    collaboration: false,
    analytics: false,
    advancedValidation: false,
    autoSave: false,
    toolbar: true,
    characterCount: true,
    providerSelection: true,
    dragAndDrop: true,
    ...features,
  };

  // All state management and handlers are encapsulated in the hook.
  // Use conditional spreading for optional props to satisfy exactOptionalPropertyTypes.
  const editor = useContentEditor({
    initialContent,
    initialTitle,
    initialTags,
    initialMedia,
    providers,
    selectedProviders: initialSelectedProviders,
    enabledFeatures,
    validateOnChange,
    ...(customValidator !== undefined && { customValidator }),
    ...(onContentChange !== undefined && { onContentChange }),
    ...(onProviderSelectionChange !== undefined && { onProviderSelectionChange }),
    ...(onMediaAdd !== undefined && { onMediaAdd }),
    ...(onMediaRemove !== undefined && { onMediaRemove }),
    ...(onValidationChange !== undefined && { onValidationChange }),
    ...(onSave !== undefined && { onSave }),
  });

  return (
    <div className={cn("content-editor-core", className)}>
      {/* Provider Selection */}
      {enabledFeatures.providerSelection && renderProviderSelector ? (
        renderProviderSelector({
          providers,
          selectedProviders: editor.selectedProviders,
          onToggle: editor.handleProviderToggle,
          validationResults: editor.validationResults,
        })
      ) : enabledFeatures.providerSelection ? (
        <DefaultProviderSelector
          providers={providers}
          selectedProviders={editor.selectedProviders}
          onToggle={editor.handleProviderToggle}
        />
      ) : null}

      {/* Main Editor Area */}
      <div
        className={cn(
          "rounded-lg border bg-card transition-colors",
          editor.isDragging && "border-primary bg-primary/5"
        )}
        onDragEnter={editor.handleDragEnter}
        onDragLeave={editor.handleDragLeave}
        onDragOver={editor.handleDragOver}
        onDrop={editor.handleDrop}
      >
        {/* Title Input */}
        <div className="border-b p-4">
          <input
            type="text"
            placeholder="Post title (optional)"
            value={editor.title}
            onChange={(e) => editor.handleTitleChange(e.target.value)}
            className="w-full text-lg font-medium bg-transparent border-none outline-hidden placeholder:text-muted-foreground"
          />
        </div>

        {/* Toolbar */}
        {enabledFeatures.toolbar && renderToolbar && (
          <div className="border-b p-2">
            {renderToolbar({
              onMediaUpload: editor.triggerMediaUpload,
            })}
          </div>
        )}

        {/* Content Textarea */}
        <div className="relative p-4">
          <textarea
            value={editor.content}
            onChange={(e) => editor.handleContentChange(e.target.value)}
            placeholder={placeholder}
            className="w-full min-h-[150px] bg-transparent border-none outline-hidden resize-none placeholder:text-muted-foreground"
          />
          {editor.isDragging && (
            <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-sm flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-medium text-primary">Drop media files here</p>
              </div>
            </div>
          )}
        </div>

        {/* Tags Display */}
        {editor.tags.length > 0 && (
          <div className="border-t p-4">
            <div className="flex flex-wrap gap-2">
              {editor.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-sm"
                >
                  #{tag}
                  <button
                    onClick={() =>
                      editor.handleTagsChange(editor.tags.filter((_, i) => i !== index))
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Media Preview */}
        {enabledFeatures.media && editor.media.length > 0 && renderMediaPreview ? (
          <div className="border-t p-4">
            {renderMediaPreview({
              media: editor.media,
              onRemove: editor.handleMediaRemove,
              maxMediaCount: editor.minMediaLimit,
              onAddMore: editor.triggerMediaUpload,
            })}
          </div>
        ) : enabledFeatures.media && editor.media.length > 0 ? (
          <DefaultMediaPreview media={editor.media} onRemove={editor.handleMediaRemove} />
        ) : null}

        {/* Character Count */}
        {enabledFeatures.characterCount && renderCharacterCount ? (
          <div className="border-t p-4">
            {renderCharacterCount({
              currentCount: editor.charCount,
              maxCount: editor.minCharLimit,
              percentage: editor.charPercentage,
              isOverLimit: editor.isOverLimit,
              isNearLimit: editor.isNearLimit,
            })}
          </div>
        ) : enabledFeatures.characterCount ? (
          <DefaultCharacterCount
            charCount={editor.charCount}
            minCharLimit={editor.minCharLimit}
            charPercentage={editor.charPercentage}
            isOverLimit={editor.isOverLimit}
            isNearLimit={editor.isNearLimit}
          />
        ) : null}
      </div>

      {/* Validation Panel */}
      {enabledFeatures.validation && renderValidationPanel && (
        <div className="mt-4">
          {renderValidationPanel({
            validationResults: editor.validationResults,
            providers,
            showAdaptationSuggestions: enabledFeatures.advancedValidation,
          })}
        </div>
      )}

      {/* Hidden file input */}
      {enabledFeatures.media && (
        <input
          ref={editor.fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => e.target.files && editor.handleMediaUpload(e.target.files)}
        />
      )}
    </div>
  );
}

/**
 * Default provider selector sub-component (inline fallback).
 */
function DefaultProviderSelector({
  providers,
  selectedProviders,
  onToggle,
}: {
  providers: ContentEditorCoreProps["providers"];
  selectedProviders: string[];
  onToggle: (providerId: string) => void;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium mb-2">Select Platforms</h3>
      <div className="flex flex-wrap gap-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onToggle(provider.id)}
            disabled={provider.isConnected === false}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              selectedProviders.includes(provider.id)
                ? "bg-primary text-primary-foreground"
                : "bg-secondary hover:bg-secondary/80",
              provider.isConnected === false && "opacity-50 cursor-not-allowed"
            )}
          >
            {provider.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Default media preview sub-component (inline fallback).
 */
function DefaultMediaPreview({
  media,
  onRemove,
}: {
  media: MediaFile[];
  onRemove: (mediaId: string) => void;
}) {
  return (
    <div className="border-t p-4">
      <div className="grid grid-cols-4 gap-2">
        {media.map((mediaItem) => (
          <div key={mediaItem.id} className="relative group">
            {mediaItem.type === "video" ? (
              <video
                src={mediaItem.url}
                className="w-full h-24 object-cover rounded-md"
                controls={false}
              />
            ) : (
              <img
                src={mediaItem.url}
                alt={mediaItem.alt}
                className="w-full h-24 object-cover rounded-md"
              />
            )}
            <button
              onClick={() => onRemove(mediaItem.id)}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Default character count sub-component (inline fallback).
 */
function DefaultCharacterCount({
  charCount,
  minCharLimit,
  charPercentage,
  isOverLimit,
  isNearLimit,
}: {
  charCount: number;
  minCharLimit: number;
  charPercentage: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
}) {
  return (
    <div className="border-t p-4">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm font-medium",
            isOverLimit && "text-destructive",
            isNearLimit && "text-yellow-600",
            !isOverLimit && !isNearLimit && "text-muted-foreground"
          )}
        >
          {charCount} / {minCharLimit}
        </span>
        <div className="flex-1 mx-4">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                isOverLimit && "bg-destructive",
                isNearLimit && "bg-yellow-500",
                !isOverLimit && !isNearLimit && "bg-primary"
              )}
              style={{ width: `${Math.min(charPercentage, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
