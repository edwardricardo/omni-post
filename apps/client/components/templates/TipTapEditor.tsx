"use client";

/**
 * @file TipTapEditor.tsx
 * @component TipTapEditor
 * @description Rich text editor built on TipTap with a formatting toolbar, character
 * count, link/color popovers, and Handlebars variable highlighting for templates.
 * @layer infrastructure
 */

import React, { useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useEditor, EditorContent } from "@tiptap/react";
// TipTap extensions and core functionality
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Button, Separator } from "@packages/ui";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Minus,
  Undo,
  Redo,
  Link as LinkIcon,
  Palette,
  Highlighter,
  Type,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@packages/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";

// Custom CSS for Handlebars variables (applied via global styles)
// Variables will be styled using regex matching in the editor

interface TipTapEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  onVariableInsert?: (variable: string) => void;
  className?: string;
}

const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onChange,
  placeholder,
  onVariableInsert,
  className = "",
}) => {
  const t = useTranslations("templates.components.tiptap");
  const resolvedPlaceholder = placeholder ?? t("placeholder");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: resolvedPlaceholder,
      }),
      CharacterCount,
      Typography,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-500 underline",
        },
      }),
      TextStyle,
      Color.configure({
        types: ["textStyle"],
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-hidden p-4 min-h-[300px]",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const insertVariable = useCallback(
    (variable: string) => {
      if (editor) {
        editor.chain().focus().insertContent(`{{${variable}}}`).run();
        onVariableInsert?.(variable);
      }
    },
    [editor, onVariableInsert]
  );

  const setColor = useCallback(
    (color: string) => {
      editor?.chain().focus().setColor(color).run();
    },
    [editor]
  );

  if (!editor) {
    return null;
  }

  const ToolbarButton: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    tooltip: string;
  }> = ({ onClick, isActive, disabled, children, tooltip }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isActive ? "default" : "ghost"}
          size="sm"
          onClick={onClick}
          disabled={disabled}
          className="h-8 w-8 p-0"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );

  const ColorPicker: React.FC = () => {
    const colors = [
      "#000000",
      "#374151",
      "#6B7280",
      "#9CA3AF",
      "#EF4444",
      "#F97316",
      "#EAB308",
      "#22C55E",
      "#3B82F6",
      "#8B5CF6",
      "#EC4899",
      "#F59E0B",
    ];

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Palette className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2">
          <div className="grid grid-cols-4 gap-1">
            {colors.map((color) => (
              <button
                key={color}
                className="w-8 h-8 rounded-sm border-2 border-gray-200 hover:border-gray-400"
                style={{ backgroundColor: color }}
                onClick={() => setColor(color)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const LinkDialog: React.FC = () => {
    const [url, setUrl] = React.useState("");

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={editor.isActive("link") ? "default" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4">
          <div className="space-y-2">
            <Label htmlFor="url">{t("urlLabel")}</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <div className="flex justify-end space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setUrl("");
                }}
              >
                {t("removeLink")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (url) {
                    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
                  }
                  setUrl("");
                }}
              >
                {t("applyLink")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="border-b bg-gray-50 p-2 flex items-center space-x-1 flex-wrap">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          tooltip={t("tooltips.undo")}
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          tooltip={t("tooltips.redo")}
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          tooltip={t("tooltips.bold")}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          tooltip={t("tooltips.italic")}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          tooltip={t("tooltips.strikethrough")}
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          tooltip={t("tooltips.inlineCode")}
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive("heading", { level: 1 })}
          tooltip={t("tooltips.heading1")}
        >
          <Type className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          tooltip={t("tooltips.heading2")}
        >
          <Type className="h-3 w-3" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          tooltip={t("tooltips.bulletList")}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          tooltip={t("tooltips.numberedList")}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          tooltip={t("tooltips.quote")}
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          isActive={editor.isActive("highlight")}
          tooltip={t("tooltips.highlight")}
        >
          <Highlighter className="h-4 w-4" />
        </ToolbarButton>

        <ColorPicker />

        <LinkDialog />

        <Separator orientation="vertical" className="h-6 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          tooltip={t("tooltips.horizontalRule")}
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <span className="text-xs font-mono">{"{{x}}"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-600 mb-2">{t("quickVariables")}</div>
              {["username", "date", "productName", "companyName", "eventName"].map((variable) => (
                <Button
                  key={variable}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => insertVariable(variable)}
                >
                  {variable}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Editor Content */}
      <div className="min-h-[300px]">
        <EditorContent editor={editor} />
      </div>

      {/* Footer */}
      {editor.storage.characterCount && (
        <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-500 flex justify-between">
          <div>{t("characters", { count: editor.storage.characterCount.characters() })}</div>
          <div>{t("words", { count: editor.storage.characterCount.words() })}</div>
        </div>
      )}
    </div>
  );
};

export default TipTapEditor;
