/**
 * @file EmojiPickerButton.tsx
 * @description Emoji picker button using emoji-mart. Opens a popover with emoji search
 *   and categories. Calls onEmojiSelect with the native emoji character.
 * @layer ui
 */

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

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
      {isOpen && (
        <div className="absolute z-50 bottom-full mb-2 left-0">
          <Picker
            data={data}
            onEmojiSelect={handleEmojiSelect}
            theme="light"
            previewPosition="none"
            skinTonePosition="search"
            maxFrequentRows={2}
            perLine={8}
          />
        </div>
      )}
    </div>
  );
}
