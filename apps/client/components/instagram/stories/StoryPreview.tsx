/**
 * @file StoryPreview.tsx
 * @component StoryPreview
 * @description Phone-frame preview component for a single Instagram Story slide, rendering
 * the media and overlay text/stickers in the 9:16 vertical aspect ratio format.
 */

import React, { useRef } from "react";
import { StoryContent } from "./types";

interface StoryPreviewProps {
  story: StoryContent;
  storyIndex: number;
  totalStories: number;
}

export function StoryPreview({ story, storyIndex, totalStories }: StoryPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="relative">
        <div className="w-72 h-128 bg-black rounded-2xl overflow-hidden shadow-2xl">
          {/* Story Header */}
          <div className="absolute top-0 left-0 right-0 p-4 bg-linear-to-b from-black/50 to-transparent z-10">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-white rounded-full"></div>
              <div className="text-white text-sm font-medium">Your Account</div>
              <div className="text-white/80 text-xs">now</div>
            </div>

            {/* Progress bar */}
            <div className="flex space-x-1 mt-3">
              {Array.from({ length: totalStories }).map((_, index) => (
                <div
                  key={index}
                  className={`h-0.5 flex-1 rounded-full ${
                    index < storyIndex
                      ? "bg-white"
                      : index === storyIndex
                        ? "bg-white/60"
                        : "bg-white/30"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Story Content */}
          <div className="w-full h-full flex items-center justify-center">
            {story.media.type === "image" ? (
              story.media.url ? (
                <img
                  src={story.media.url}
                  alt={story.media.alt}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-lg"
                  style={{
                    background: story.background?.gradient || story.background?.color || "#667eea",
                  }}
                >
                  {story.text}
                </div>
              )
            ) : (
              <video
                ref={videoRef}
                src={story.media.url}
                className="w-full h-full object-cover"
                controls
                muted
                playsInline
              />
            )}
          </div>

          {/* Story Text Overlay */}
          {story.text && story.media.url && (
            <div className="absolute bottom-4 left-4 right-4 text-white text-center">
              <div className="bg-black/30 rounded-lg p-3">{story.text}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
