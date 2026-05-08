/**
 * @file StoryEditorControls.tsx
 * @component StoryEditorControls
 * @description Editor controls panel for a single story slide, providing options to add
 * text overlays, stickers, link stickers, and video split configuration.
 */

import React, { useId } from "react";
import { StoryContent, VideoSplitOptions } from "./types";

interface StoryEditorControlsProps {
  story: StoryContent;
  storyIndex: number;
  videoSplitOptions: VideoSplitOptions;
  onUpdateStory: (index: number, updates: Partial<StoryContent>) => void;
  onUpdateVideoSplitOptions: (options: VideoSplitOptions) => void;
}

export function StoryEditorControls({
  story,
  storyIndex,
  videoSplitOptions,
  onUpdateStory,
  onUpdateVideoSplitOptions,
}: StoryEditorControlsProps) {
  const storyTextId = useId();
  const durationId = useId();
  const segmentLengthId = useId();
  const qualityId = useId();
  const backgroundHeadingId = useId();

  return (
    <div className="bg-white border-t p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Text Editor */}
        <div>
          <label htmlFor={storyTextId} className="block text-sm font-medium text-gray-700 mb-2">
            Story Text
          </label>
          <textarea
            id={storyTextId}
            value={story.text || ""}
            onChange={(e) =>
              onUpdateStory(storyIndex, {
                ...(e.target.value && { text: e.target.value }),
              })
            }
            className="w-full px-3 py-2 border rounded-lg resize-none"
            rows={3}
            placeholder="Add text to your story..."
          />
        </div>

        {/* Duration Control */}
        <div>
          <label htmlFor={durationId} className="block text-sm font-medium text-gray-700 mb-2">
            Display Duration: {story.duration}s
          </label>
          <input
            id={durationId}
            type="range"
            min="3"
            max="15"
            value={story.duration}
            onChange={(e) => onUpdateStory(storyIndex, { duration: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>3s</span>
            <span>15s</span>
          </div>
        </div>

        {/* Background Controls (for text stories) */}
        {!story.media.url && (
          <div>
            <span id={backgroundHeadingId} className="block text-sm font-medium text-gray-700 mb-2">
              Background
            </span>
            <div
              role="group"
              aria-labelledby={backgroundHeadingId}
              className="grid grid-cols-4 gap-2"
            >
              {[
                "linear-gradient(45deg, #667eea 0%, #764ba2 100%)",
                "linear-gradient(45deg, #f093fb 0%, #f5576c 100%)",
                "linear-gradient(45deg, #4facfe 0%, #00f2fe 100%)",
                "linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)",
              ].map((gradient, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Background option ${index + 1}`}
                  onClick={() =>
                    onUpdateStory(storyIndex, {
                      background: { gradient },
                    })
                  }
                  className="w-full h-12 rounded-lg border-2 border-transparent hover:border-gray-300"
                  style={{ background: gradient }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Video Split Options (for videos) */}
        {story.media.type === "video" && story.media.duration && story.media.duration > 15 && (
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-sm font-medium text-gray-700 mb-2 p-0">
              Video Split Options
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={segmentLengthId} className="block text-xs text-gray-600 mb-1">
                  Segment Length
                </label>
                <select
                  id={segmentLengthId}
                  value={videoSplitOptions.segmentLength}
                  onChange={(e) =>
                    onUpdateVideoSplitOptions({
                      ...videoSplitOptions,
                      segmentLength: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-sm text-sm"
                >
                  <option value={10}>10 seconds</option>
                  <option value={15}>15 seconds</option>
                </select>
              </div>
              <div>
                <label htmlFor={qualityId} className="block text-xs text-gray-600 mb-1">
                  Quality
                </label>
                <select
                  id={qualityId}
                  value={videoSplitOptions.quality}
                  onChange={(e) =>
                    onUpdateVideoSplitOptions({
                      ...videoSplitOptions,
                      quality: e.target.value as "low" | "medium" | "high",
                    })
                  }
                  className="w-full px-3 py-2 border rounded-sm text-sm"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
}
