/**
 * @file EmojiPickerButton.tsx
 * @description Emoji picker button using emoji-mart. Opens a popover with emoji search
 *   and categories. Calls onEmojiSelect with the native emoji character.
 * @component EmojiPickerButton
 * @layer infrastructure
 */

"use client";

import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from "react";
import type { EmojiMartData } from "@emoji-mart/data";

const Picker = lazy(() => import("@emoji-mart/react"));

interface EmojiPickerButtonProps {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}

interface EmojiMartEmoji {
  native: string;
  id: string;
  name: string;
}

export function EmojiPickerButton({
  onEmojiSelect,
  disabled = false,
  className = "",
}: EmojiPickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [emojiData, setEmojiData] = useState<EmojiMartData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEmojiSelect = useCallback(
    (emoji: EmojiMartEmoji) => {
      onEmojiSelect(emoji.native);
      setIsOpen(false);
    },
    [onEmojiSelect]
  );

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && emojiData === null) {
      void import("@emoji-mart/data").then((m) => {
        const mod = m as unknown as { default?: EmojiMartData } & EmojiMartData;
        setEmojiData(mod.default ?? mod);
      });
    }
  }, [isOpen, emojiData]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="p-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Insert emoji"
        aria-expanded={isOpen}
        title="Insert emoji"
      >
        <span className="text-lg" role="img" aria-hidden="true">
          😊
        </span>
      </button>
      {isOpen && emojiData && (
        <div className="absolute z-50 bottom-full mb-2 left-0">
          <Suspense fallback={<div className="p-3 text-sm text-muted-foreground">Loading…</div>}>
            <Picker
              data={emojiData}
              onEmojiSelect={handleEmojiSelect}
              theme="light"
              previewPosition="none"
              skinTonePosition="search"
              maxFrequentRows={2}
              perLine={8}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
