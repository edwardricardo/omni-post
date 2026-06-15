"use client";

/**
 * @file useContentEditor.ts
 * @description Hook that owns editor state (content, media, validation, debounced change) for the
 *              ContentEditorCore component, applying provider-constraint-aware validation.
 * @layer infrastructure
 */
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { ConsoleLoggerAdapter, extractErrorInfo } from "@observability/browser-logger";
import type {
  MediaFile,
  ProviderConstraints,
  ValidationResult,
  ContentEditorContent,
  ContentEditorCoreFeatures,
} from "./contentEditorTypes.js";
import {
  validateContentForProvider,
  getMinCharLimit,
  getMinMediaLimit,
  debounce,
} from "./contentEditorTypes.js";

// packages/ui is framework-agnostic and cannot assume a LoggerProvider is in
// scope — instantiate the console adapter directly. Consumers that want richer
// telemetry can capture failures via the onSave promise they pass in.
const contentEditorLogger = new ConsoleLoggerAdapter("ui.content-editor");

/**
 * Configuration for the useContentEditor hook.
 */
export interface UseContentEditorOptions {
  initialContent?: string;
  initialTitle?: string;
  initialTags?: string[];
  initialMedia?: MediaFile[];
  providers: ProviderConstraints[];
  selectedProviders?: string[];
  enabledFeatures: Required<ContentEditorCoreFeatures>;
  validateOnChange?: boolean;
  customValidator?: (
    content: ContentEditorContent,
    providers: ProviderConstraints[]
  ) => Record<string, ValidationResult>;

  // Callbacks
  onContentChange?: (content: ContentEditorContent) => void;
  onProviderSelectionChange?: (providerIds: string[]) => void;
  onMediaAdd?: (files: File[]) => void;
  onMediaRemove?: (mediaId: string) => void;
  onValidationChange?: (results: Record<string, ValidationResult>) => void;
  onSave?: (content: ContentEditorContent) => Promise<void>;
}

/**
 * Return type for the useContentEditor hook.
 */
export interface UseContentEditorReturn {
  // State
  content: string;
  title: string;
  tags: string[];
  media: MediaFile[];
  selectedProviders: string[];
  validationResults: Record<string, ValidationResult>;
  isDragging: boolean;
  charCount: number;

  // Computed
  activeProviders: ProviderConstraints[];
  minCharLimit: number;
  minMediaLimit: number;
  charPercentage: number;
  isOverLimit: boolean;
  isNearLimit: boolean;

  // Refs
  fileInputRef: React.RefObject<HTMLInputElement | null>;

  // Handlers
  handleContentChange: (newContent: string) => void;
  handleTitleChange: (newTitle: string) => void;
  handleTagsChange: (newTags: string[]) => void;
  handleProviderToggle: (providerId: string) => void;
  handleMediaUpload: (files: FileList | File[]) => void;
  handleMediaRemove: (mediaId: string) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  triggerMediaUpload: () => void;
  insertTextAtCursor: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Custom hook encapsulating all ContentEditorCore state management and handlers.
 *
 * Extracted from ContentEditorCore to keep the component file under 800 lines.
 * Contains: state declarations, computed values, validation logic,
 * content/media/provider handlers, and drag-and-drop handlers.
 *
 * @param options - Configuration and callbacks for the editor
 * @returns State, computed values, refs, and handler functions
 */
export function useContentEditor(options: UseContentEditorOptions): UseContentEditorReturn {
  const {
    initialContent = "",
    initialTitle = "",
    initialTags = [],
    initialMedia = [],
    providers,
    selectedProviders: initialSelectedProviders = [],
    enabledFeatures,
    validateOnChange = true,
    customValidator,
    onContentChange,
    onProviderSelectionChange,
    onMediaAdd,
    onMediaRemove,
    onValidationChange,
    onSave,
  } = options;

  // State
  const [content, setContent] = useState(initialContent);
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [media, setMedia] = useState<MediaFile[]>(initialMedia);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(initialSelectedProviders);
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [charCount, setCharCount] = useState(initialContent.length);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  // Get active providers
  const activeProviders = useMemo(() => {
    return providers.filter((p) => selectedProviders.includes(p.id));
  }, [providers, selectedProviders]);

  // Calculate limits
  const minCharLimit = useMemo(() => getMinCharLimit(activeProviders), [activeProviders]);
  const minMediaLimit = useMemo(() => getMinMediaLimit(activeProviders), [activeProviders]);

  // Validation
  const validateContent = useCallback(
    (currentContent: ContentEditorContent, targetProviders: string[]) => {
      if (targetProviders.length === 0) {
        setValidationResults({});
        onValidationChange?.({});
        return;
      }

      let results: Record<string, ValidationResult>;

      if (customValidator) {
        const targetProviderObjects = providers.filter((p) => targetProviders.includes(p.id));
        results = customValidator(currentContent, targetProviderObjects);
      } else {
        results = {};
        for (const providerId of targetProviders) {
          const provider = providers.find((p) => p.id === providerId);
          if (provider) {
            results[providerId] = validateContentForProvider(currentContent, provider);
          }
        }
      }

      setValidationResults(results);
      onValidationChange?.(results);
    },
    [providers, customValidator, onValidationChange]
  );

  // Debounced validation
  const debouncedValidation = useMemo(
    () =>
      debounce((debouncedContent: ContentEditorContent, debouncedProviders: string[]) => {
        validateContent(debouncedContent, debouncedProviders);
      }, 300),
    [validateContent]
  );

  // Debounced auto-save
  const debouncedSave = useMemo(
    () =>
      debounce((saveContent: ContentEditorContent) => {
        if (onSave && enabledFeatures.autoSave) {
          onSave(saveContent).catch((err: unknown) => {
            // Auto-save failure is non-critical; next save attempt will retry.
            // Log so recurring failures surface in APM even when the user is unaware.
            contentEditorLogger.warn("Auto-save failed", { err: extractErrorInfo(err) });
          });
        }
      }, 1000),
    [onSave, enabledFeatures.autoSave]
  );

  // Helper: build ContentEditorContent from current state
  const buildContent = useCallback(
    (overrides?: {
      text?: string;
      title?: string;
      tags?: string[];
      media?: MediaFile[];
    }): ContentEditorContent => {
      const t = overrides?.text ?? content;
      const ti = overrides?.title ?? title;
      const ta = overrides?.tags ?? tags;
      const m = overrides?.media ?? media;

      return {
        text: t,
        ...(ti && { title: ti }),
        ...(ta.length > 0 && { tags: ta }),
        ...(m.length > 0 && { media: m }),
      };
    },
    [content, title, tags, media]
  );

  // Content change handler
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setCharCount(newContent.length);

      const updatedContent = buildContent({ text: newContent });

      onContentChange?.(updatedContent);

      if (validateOnChange && enabledFeatures.validation) {
        debouncedValidation(updatedContent, selectedProviders);
      }

      if (enabledFeatures.autoSave) {
        debouncedSave(updatedContent);
      }
    },
    [
      buildContent,
      onContentChange,
      validateOnChange,
      enabledFeatures.validation,
      enabledFeatures.autoSave,
      debouncedValidation,
      debouncedSave,
      selectedProviders,
    ]
  );

  // Title change handler
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      const updatedContent = buildContent({ title: newTitle });
      onContentChange?.(updatedContent);
    },
    [buildContent, onContentChange]
  );

  // Tags change handler
  const handleTagsChange = useCallback(
    (newTags: string[]) => {
      setTags(newTags);
      const updatedContent = buildContent({ tags: newTags });
      onContentChange?.(updatedContent);
    },
    [buildContent, onContentChange]
  );

  // Provider toggle handler
  const handleProviderToggle = useCallback(
    (providerId: string) => {
      const newSelectedProviders = selectedProviders.includes(providerId)
        ? selectedProviders.filter((id) => id !== providerId)
        : [...selectedProviders, providerId];

      setSelectedProviders(newSelectedProviders);
      onProviderSelectionChange?.(newSelectedProviders);

      if (validateOnChange && enabledFeatures.validation) {
        const currentContent = buildContent();
        validateContent(currentContent, newSelectedProviders);
      }
    },
    [
      selectedProviders,
      onProviderSelectionChange,
      validateOnChange,
      enabledFeatures.validation,
      buildContent,
      validateContent,
    ]
  );

  // Media upload handler
  const handleMediaUpload = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const validFiles = fileArray.filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
      );

      if (validFiles.length === 0) return;

      if (validFiles.length + media.length > minMediaLimit) {
        // Maximum media limit reached — silently reject excess files
        return;
      }

      const newMedia: MediaFile[] = validFiles.map((file, index) => ({
        id: `media_${Date.now()}_${index}`,
        type: file.type.startsWith("video/") ? ("video" as const) : ("image" as const),
        url: URL.createObjectURL(file),
        file,
        alt: file.name,
        metadata: {
          size: file.size,
        },
      }));

      const updatedMedia = [...media, ...newMedia];
      setMedia(updatedMedia);
      onMediaAdd?.(validFiles);

      if (validateOnChange && enabledFeatures.validation) {
        const updatedContent = buildContent({ media: updatedMedia });
        debouncedValidation(updatedContent, selectedProviders);
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [
      media,
      minMediaLimit,
      onMediaAdd,
      validateOnChange,
      enabledFeatures.validation,
      buildContent,
      debouncedValidation,
      selectedProviders,
    ]
  );

  // Media remove handler
  const handleMediaRemove = useCallback(
    (mediaId: string) => {
      const updatedMedia = media.filter((m) => m.id !== mediaId);
      setMedia(updatedMedia);
      onMediaRemove?.(mediaId);

      if (validateOnChange && enabledFeatures.validation) {
        const updatedContent = buildContent({ media: updatedMedia });
        debouncedValidation(updatedContent, selectedProviders);
      }
    },
    [
      media,
      onMediaRemove,
      validateOnChange,
      enabledFeatures.validation,
      buildContent,
      debouncedValidation,
      selectedProviders,
    ]
  );

  // Drag and drop handlers
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabledFeatures.dragAndDrop) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    },
    [enabledFeatures.dragAndDrop]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabledFeatures.dragAndDrop) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    },
    [enabledFeatures.dragAndDrop]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabledFeatures.dragAndDrop) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [enabledFeatures.dragAndDrop]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enabledFeatures.dragAndDrop) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      const files = Array.from(e.dataTransfer.files);
      handleMediaUpload(files);
    },
    [enabledFeatures.dragAndDrop, handleMediaUpload]
  );

  // Character count calculations
  const charPercentage = (charCount / minCharLimit) * 100;
  const isOverLimit = charCount > minCharLimit;
  const isNearLimit = charPercentage > 80 && charPercentage <= 100;

  // Trigger media upload
  const triggerMediaUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Update content when initialContent changes (for external updates)
  useEffect(() => {
    if (initialContent !== content) {
      setContent(initialContent);
      setCharCount(initialContent.length);
    }
    // Intentionally exclude `content` from deps to avoid infinite loops.
    // We only want to react to external initialContent changes, not internal state updates.
  }, [initialContent]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newContent = content.substring(0, start) + text + content.substring(end);
        handleContentChange(newContent);
        // Restore cursor position after the inserted text
        requestAnimationFrame(() => {
          textarea.selectionStart = start + text.length;
          textarea.selectionEnd = start + text.length;
          textarea.focus();
        });
      } else {
        // Fallback: append at end
        handleContentChange(content + text);
      }
    },
    [content, handleContentChange]
  );

  return {
    // State
    content,
    title,
    tags,
    media,
    selectedProviders,
    validationResults,
    isDragging,
    charCount,

    // Computed
    activeProviders,
    minCharLimit,
    minMediaLimit,
    charPercentage,
    isOverLimit,
    isNearLimit,

    // Refs
    fileInputRef,

    // Handlers
    handleContentChange,
    handleTitleChange,
    handleTagsChange,
    handleProviderToggle,
    handleMediaUpload,
    handleMediaRemove,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    triggerMediaUpload,
    insertTextAtCursor,
    textareaRef,
  };
}
