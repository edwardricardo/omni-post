/**
 * @file useKeyboardShortcuts.ts
 * @description Custom hook that registers keyboard shortcuts for the Instagram Stories editor,
 * enabling navigation between stories and quick actions via keyboard input.
 */

import { useEffect } from "react";

interface UseKeyboardShortcutsProps {
  selectedStoryIndex: number | null;
  totalStories: number;
  onSave: () => void;
  onSelectStory: (index: number) => void;
}

export function useKeyboardShortcuts({
  selectedStoryIndex,
  totalStories,
  onSave,
  onSelectStory,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "s":
            e.preventDefault();
            onSave();
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (selectedStoryIndex !== null && selectedStoryIndex > 0) {
              onSelectStory(selectedStoryIndex - 1);
            }
            break;
          case "ArrowRight":
            e.preventDefault();
            if (selectedStoryIndex !== null && selectedStoryIndex < totalStories - 1) {
              onSelectStory(selectedStoryIndex + 1);
            }
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [selectedStoryIndex, totalStories, onSave, onSelectStory]);
}
