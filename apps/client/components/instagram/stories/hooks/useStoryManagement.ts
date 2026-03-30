/**
 * @file useStoryManagement.ts
 * @description Custom hook encapsulating story ordering and management logic for the Stories
 * editor, including add, remove, reorder, and update operations on story items.
 */

import { useCallback } from "react";
import { StoryContent } from "../types";

interface UseStoryManagementProps {
  onUpdate: (updater: (stories: StoryContent[]) => StoryContent[]) => void;
  selectedStoryIndex: number | null;
  onSelectStory: (index: number | null) => void;
}

export function useStoryManagement({
  onUpdate,
  selectedStoryIndex,
  onSelectStory,
}: UseStoryManagementProps) {
  const addTextStory = useCallback(() => {
    const storyContent: StoryContent = {
      id: `story-${Date.now()}`,
      media: {
        id: `text-media-${Date.now()}`,
        type: "image",
        url: "",
        alt: "Text story",
      },
      text: "Your text here...",
      duration: 5,
      background: {
        gradient: "linear-gradient(45deg, #667eea 0%, #764ba2 100%)",
      },
    };

    onUpdate((stories) => [...stories, storyContent]);
  }, [onUpdate]);

  const updateStory = useCallback(
    (index: number, updates: Partial<StoryContent>) => {
      onUpdate((stories) =>
        stories.map((story, i) =>
          i === index
            ? {
                ...story,
                ...Object.fromEntries(
                  Object.entries(updates).filter(([_, value]) => value !== undefined)
                ),
              }
            : story
        )
      );
    },
    [onUpdate]
  );

  const deleteStory = useCallback(
    (index: number) => {
      onUpdate((stories) => stories.filter((_, i) => i !== index));

      if (selectedStoryIndex === index) {
        onSelectStory(null);
      } else if (selectedStoryIndex !== null && selectedStoryIndex > index) {
        onSelectStory(selectedStoryIndex - 1);
      }
    },
    [onUpdate, selectedStoryIndex, onSelectStory]
  );

  const reorderStories = useCallback(
    (fromIndex: number, toIndex: number) => {
      onUpdate((stories) => {
        const newStories = [...stories];
        const [movedStory] = newStories.splice(fromIndex, 1);
        if (movedStory) {
          newStories.splice(toIndex, 0, movedStory);
        }
        return newStories;
      });
    },
    [onUpdate]
  );

  return {
    addTextStory,
    updateStory,
    deleteStory,
    reorderStories,
  };
}
