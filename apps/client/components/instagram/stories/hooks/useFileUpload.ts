/**
 * @file useFileUpload.ts
 * @description Custom hook managing file upload state for Instagram Stories, handling image
 * and video file selection, video splitting, and upload progress tracking.
 */

import { useState, useCallback } from "react";
import { StoryMedia, StoryContent, VideoSplitOptions } from "../types.js";
import { getVideoDuration, splitVideoIntoSegments } from "../utils.js";

interface UseFileUploadProps {
  videoSplitOptions: VideoSplitOptions;
  onStoryCreate: (story: StoryContent) => void;
  onStoriesCreate: (stories: StoryContent[]) => void;
  /**
   * Called when a video longer than 15s is uploaded. Should resolve to `true`
   * when the user agrees to split the video, `false` to keep the first 15s.
   * Consumers typically implement this with a ConfirmDialog.
   */
  confirmVideoSplit: (durationSeconds: number) => Promise<boolean>;
  onError?: (error: string) => void;
}

export function useFileUpload({
  videoSplitOptions,
  onStoryCreate,
  onStoriesCreate,
  confirmVideoSplit,
  onError,
}: UseFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileUpload = useCallback(
    async (files: FileList | null, type: "image" | "video") => {
      if (!files || files.length === 0) return;

      setIsUploading(true);
      try {
        for (const file of Array.from(files)) {
          // Validate file type
          const isValidType =
            type === "image" ? file.type.startsWith("image/") : file.type.startsWith("video/");

          if (!isValidType) {
            onError?.(`Invalid file type. Expected ${type}.`);
            continue;
          }

          // Create preview URL
          const previewUrl = URL.createObjectURL(file);

          // Create media object
          const media: StoryMedia = {
            id: `media-${crypto.randomUUID()}`,
            type,
            url: previewUrl,
            file,
            preview: previewUrl,
            alt: file.name,
          };

          // For videos, handle duration and potential splitting
          if (type === "video") {
            const duration = await getVideoDuration(file);
            media.duration = duration;

            // If video is longer than 15 seconds, offer to split
            if (duration > 15) {
              const shouldSplit = await confirmVideoSplit(duration);

              if (shouldSplit) {
                setIsProcessing(true);
                try {
                  const segments = await splitVideoIntoSegments(media, videoSplitOptions);
                  media.segments = segments;

                  // Create multiple stories for each segment
                  const newStories: StoryContent[] = segments.map((segment, index) => ({
                    id: `story-${Date.now()}-${index}`,
                    media: {
                      ...media,
                      id: `media-${segment.id}`,
                      url: segment.url,
                      duration: segment.duration,
                    },
                    duration: 15,
                  }));

                  onStoriesCreate(newStories);
                } catch (error) {
                  onError?.(
                    `Failed to process video: ${error instanceof Error ? error.message : String(error)}`
                  );
                } finally {
                  setIsProcessing(false);
                }
              } else {
                // Use first 15 seconds of video
                const storyContent: StoryContent = {
                  id: `story-${Date.now()}`,
                  media: { ...media, duration: 15 },
                  duration: 15,
                };
                onStoryCreate(storyContent);
              }
            } else {
              // Video is already within limits
              const storyContent: StoryContent = {
                id: `story-${Date.now()}`,
                media,
                duration: Math.max(5, Math.min(15, duration)),
              };
              onStoryCreate(storyContent);
            }
          } else {
            // Image story
            const storyContent: StoryContent = {
              id: `story-${Date.now()}`,
              media,
              duration: 5,
            };
            onStoryCreate(storyContent);
          }
        }
      } catch (error) {
        onError?.(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsUploading(false);
      }
    },
    [videoSplitOptions, onStoryCreate, onStoriesCreate, confirmVideoSplit, onError]
  );

  return {
    isUploading,
    isProcessing,
    handleFileUpload,
  };
}
