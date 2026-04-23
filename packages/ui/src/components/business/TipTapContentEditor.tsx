"use client";

/**
 * @file TipTapContentEditor.tsx
 * @description Rich-text content editor built on TipTap with StarterKit, CharacterCount, and
 *              Placeholder extensions; wraps ContentEditorCore for toolbar and preview rendering.
 * @component TipTapContentEditor
 * @layer infrastructure
 */
import React, { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Hash, Link, Image, Smile, X } from "lucide-react";
import {
  ContentEditorCore,
  type ContentEditorCoreProps,
  type ToolbarRenderProps,
  type MediaPreviewRenderProps,
  type CharacterCountRenderProps,
  type ProviderConstraints,
  getMinCharLimit,
} from "./ContentEditorCore";
import { Button } from "../button";
import { cn } from "../../lib/utils";

export interface TipTapContentEditorProps extends Omit<
  ContentEditorCoreProps,
  "renderToolbar" | "renderMediaPreview" | "renderCharacterCount"
> {
  // TipTap-specific props
  enableRichText?: boolean;
  enableEmoji?: boolean;
  showToolbar?: boolean;
  editorClassName?: string;
  commonEmojis?: string[];
}

/**
 * TipTap-enhanced Content Editor
 * Extends ContentEditorCore with TipTap rich text editing capabilities
 */
export function TipTapContentEditor({
  initialContent = "",
  providers,
  selectedProviders: initialSelectedProviders = [],
  enableRichText = true,
  enableEmoji = true,
  showToolbar = true,
  editorClassName,
  placeholder = "What's on your mind?",
  commonEmojis = [
    "😀",
    "😂",
    "🥰",
    "😎",
    "🤔",
    "👍",
    "👏",
    "🔥",
    "💯",
    "✨",
    "🚀",
    "💡",
    "📱",
    "💻",
    "🎉",
    "❤️",
  ],
  onContentChange,
  ...baseProps
}: TipTapContentEditorProps) {
  const [selectedProviders, setSelectedProviders] = useState<string[]>(initialSelectedProviders);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Get active providers for char limit
  const activeProviders = providers.filter((p: { id: string }) => selectedProviders.includes(p.id));
  const charLimit = getMinCharLimit(activeProviders);

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      CharacterCount.configure({
        limit: charLimit,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor: updatedEditor }) => {
      const text = updatedEditor.getText();
      const _charCount = updatedEditor.storage.characterCount.characters();

      onContentChange?.({
        text,
        ...(baseProps.initialTitle && { title: baseProps.initialTitle }),
        ...(baseProps.initialTags &&
          baseProps.initialTags.length > 0 && { tags: baseProps.initialTags }),
        ...(baseProps.initialMedia &&
          baseProps.initialMedia.length > 0 && { media: baseProps.initialMedia }),
      });
    },
    editorProps: {
      attributes: {
        class: cn("prose prose-sm max-w-none focus:outline-hidden min-h-[150px]", editorClassName),
      },
    },
  });

  // Update character limit when providers change
  useEffect(() => {
    if (editor) {
      editor.extensionManager.extensions.forEach((extension) => {
        if (extension.name === "characterCount") {
          extension.options.limit = charLimit;
        }
      });
    }
  }, [charLimit, editor]);

  // Load initial content
  useEffect(() => {
    if (editor && initialContent && editor.getText() !== initialContent) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor]);

  // Emoji insertion
  const addEmoji = useCallback(
    (emoji: string) => {
      editor?.chain().focus().insertContent(emoji).run();
      setShowEmojiPicker(false);
    },
    [editor]
  );

  // Custom toolbar renderer
  const renderToolbar = useCallback(
    (props: ToolbarRenderProps) => {
      if (!showToolbar) return null;

      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {enableRichText && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                  className={cn(editor?.isActive("bold") && "bg-secondary")}
                  type="button"
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                  className={cn(editor?.isActive("italic") && "bg-secondary")}
                  type="button"
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <div className="h-6 w-px bg-border mx-1" />
              </>
            )}
            <Button variant="ghost" size="sm" type="button">
              <Hash className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" type="button">
              <Link className="h-4 w-4" />
            </Button>
            <div className="h-6 w-px bg-border mx-1" />
            <Button variant="ghost" size="sm" onClick={props.onMediaUpload} type="button">
              <Image className="h-4 w-4" />
            </Button>
            {enableEmoji && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Add Emoji"
                  type="button"
                >
                  <Smile className="h-4 w-4" />
                </Button>
                {showEmojiPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-card border rounded-md shadow-lg p-2 grid grid-cols-8 gap-1 z-10">
                    {commonEmojis.map((emoji, index) => (
                      <button
                        key={index}
                        onClick={() => addEmoji(emoji)}
                        className="text-lg hover:bg-secondary p-1 rounded-sm"
                        type="button"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    },
    [showToolbar, enableRichText, enableEmoji, editor, showEmojiPicker, commonEmojis, addEmoji]
  );

  // Custom media preview renderer
  const renderMediaPreview = useCallback((props: MediaPreviewRenderProps) => {
    return (
      <div className="grid grid-cols-4 gap-2">
        {props.media.map((mediaItem) => (
          <div key={mediaItem.id} className="relative group">
            {mediaItem.type === "video" ? (
              <div className="w-full h-24 bg-secondary rounded-md flex items-center justify-center">
                <video
                  src={mediaItem.url}
                  className="w-full h-full object-cover rounded-md"
                  controls={false}
                />
              </div>
            ) : (
              <img
                src={mediaItem.url}
                alt={mediaItem.alt}
                className="w-full h-24 object-cover rounded-md"
              />
            )}
            <Button
              onClick={() => props.onRemove(mediaItem.id)}
              variant="destructive"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              type="button"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {props.media.length < props.maxMediaCount && (
          <button
            onClick={props.onAddMore}
            className="h-24 border-2 border-dashed border-muted-foreground/25 rounded-md flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
            type="button"
          >
            <span className="text-muted-foreground text-sm">Add Media</span>
          </button>
        )}
      </div>
    );
  }, []);

  // Custom character count renderer
  const renderCharacterCount = useCallback((props: CharacterCountRenderProps) => {
    return (
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm font-medium",
            props.isOverLimit && "text-destructive",
            props.isNearLimit && !props.isOverLimit && "text-yellow-600",
            !props.isOverLimit && !props.isNearLimit && "text-muted-foreground"
          )}
        >
          {props.currentCount} / {props.maxCount}
        </span>
        <div className="flex-1 mx-4">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                props.isOverLimit && "bg-destructive",
                props.isNearLimit && !props.isOverLimit && "bg-yellow-500",
                !props.isOverLimit && !props.isNearLimit && "bg-primary"
              )}
              style={{ width: `${Math.min(props.percentage, 100)}%` }}
            />
          </div>
        </div>
        {props.isOverLimit && (
          <span className="text-sm text-muted-foreground">
            Will create thread with {Math.ceil(props.currentCount / props.maxCount)} posts
          </span>
        )}
      </div>
    );
  }, []);

  // Override content textarea with TipTap editor
  return (
    <div className="tiptap-content-editor">
      {/* Render base with custom renderers but replace textarea with EditorContent */}
      <div className={baseProps.className}>
        {/* Provider selection handled by core */}
        {baseProps.features?.providerSelection !== false && (
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Select Platforms</h3>
            <div className="flex flex-wrap gap-2">
              {providers.map((provider: ProviderConstraints) => (
                <button
                  key={provider.id}
                  onClick={() => {
                    const newSelected = selectedProviders.includes(provider.id)
                      ? selectedProviders.filter((id) => id !== provider.id)
                      : [...selectedProviders, provider.id];
                    setSelectedProviders(newSelected);
                    baseProps.onProviderSelectionChange?.(newSelected);
                  }}
                  disabled={provider.isConnected === false}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    selectedProviders.includes(provider.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-secondary/80",
                    provider.isConnected === false && "opacity-50 cursor-not-allowed"
                  )}
                  type="button"
                >
                  {provider.color && (
                    <div
                      className="h-3 w-3 rounded-xs"
                      style={{ backgroundColor: provider.color }}
                    />
                  )}
                  {provider.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Use core component for structure but with TipTap editor */}
        <ContentEditorCore
          {...baseProps}
          providers={providers}
          selectedProviders={selectedProviders}
          onProviderSelectionChange={setSelectedProviders}
          initialContent={initialContent}
          placeholder={placeholder}
          renderToolbar={renderToolbar}
          renderMediaPreview={renderMediaPreview}
          renderCharacterCount={renderCharacterCount}
          {...(onContentChange && { onContentChange })}
        />

        {/* Overlay TipTap editor */}
        {editor && (
          <div className="absolute inset-0 pointer-events-none">
            <EditorContent editor={editor} className="pointer-events-auto p-4" />
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export types
export type { ProviderConstraints, ContentEditorContent } from "./ContentEditorCore";
