/**
 * @file StoriesTimeline.tsx
 * @description Horizontal timeline strip showing all story slides as thumbnails, supporting
 * drag-to-reorder, selection, and add/remove operations for the Stories editor.
 */

import React, { useRef } from "react";
import { StoryContent } from "./types";

interface StoriesTimelineProps {
  stories: StoryContent[];
  selectedStoryIndex: number | null;
  isDisabled: boolean;
  onStorySelect: (index: number) => void;
  onStoryDelete: (index: number) => void;
  onImageUpload: (files: FileList | null) => void;
  onVideoUpload: (files: FileList | null) => void;
  onAddTextStory: () => void;
}

export function StoriesTimeline({
  stories,
  selectedStoryIndex,
  isDisabled,
  onStorySelect,
  onStoryDelete,
  onImageUpload,
  onVideoUpload,
  onAddTextStory,
}: StoriesTimelineProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="w-64 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <h3 className="font-medium text-gray-900 mb-3">Stories ({stories.length})</h3>

        {/* Add Story Buttons */}
        <div className="space-y-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled}
            className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm hover:border-gray-400 disabled:opacity-50"
          >
            📷 Add Photo
          </button>

          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={isDisabled}
            className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm hover:border-gray-400 disabled:opacity-50"
          >
            🎥 Add Video
          </button>

          <button
            onClick={onAddTextStory}
            disabled={isDisabled}
            className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm hover:border-gray-400 disabled:opacity-50"
          >
            📝 Add Text
          </button>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onImageUpload(e.target.files)}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => onVideoUpload(e.target.files)}
        />
      </div>

      {/* Stories List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {stories.map((story, index) => (
          <div
            key={story.id}
            className={`relative p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedStoryIndex === index
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
            onClick={() => onStorySelect(index)}
          >
            <div className="flex items-center space-x-3">
              <div className="w-12 h-20 bg-gray-200 rounded-lg overflow-hidden flex-shrink-0">
                {story.media.type === "image" ? (
                  story.media.url ? (
                    <img
                      src={story.media.url}
                      alt={story.media.alt}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                      Text
                    </div>
                  )
                ) : (
                  <video src={story.media.url} className="w-full h-full object-cover" muted />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">Story {index + 1}</div>
                <div className="text-xs text-gray-500">
                  {story.media.type} • {story.duration}s
                </div>
                {story.text && <div className="text-xs text-gray-400 truncate">{story.text}</div>}
                {story.media.segments && (
                  <div className="text-xs text-blue-600">
                    {story.media.segments.length} segments
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onStoryDelete(index);
              }}
              className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
            >
              ×
            </button>
          </div>
        ))}

        {stories.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📱</div>
            <div className="text-sm">No stories yet</div>
            <div className="text-xs text-gray-400">Add photos, videos, or text to get started</div>
          </div>
        )}
      </div>
    </div>
  );
}
