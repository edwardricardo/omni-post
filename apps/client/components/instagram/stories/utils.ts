/**
 * @file utils.ts
 * @description Utility functions for Instagram Stories, including video duration extraction,
 * client-side video splitting, and story media validation helpers.
 */

import { StoryMedia, VideoSegment, VideoSplitOptions } from "./types";

/**
 * Get video duration from a File object
 */
export const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = reject;
    video.src = URL.createObjectURL(file);
  });
};

/**
 * Split video into time-range segments for Instagram Stories.
 *
 * Uses HTML5 Media Fragments (URL #t= syntax) for client-side preview.
 * The actual server-side transcoding happens via the media processor API
 * when the stories are published.
 */
export const splitVideoIntoSegments = async (
  media: StoryMedia,
  options: VideoSplitOptions
): Promise<VideoSegment[]> => {
  const totalDuration = media.duration || 0;
  const segmentLength = options.segmentLength || 15;
  const maxSegments = options.maxSegments || 100;
  const segmentCount = Math.min(Math.ceil(totalDuration / segmentLength), maxSegments);

  const segments: VideoSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const startTime = i * segmentLength;
    const endTime = Math.min(startTime + segmentLength, totalDuration);

    segments.push({
      id: `segment-${i}`,
      url: `${media.url}#t=${startTime},${endTime}`,
      duration: endTime - startTime,
      sequence: i + 1,
      startTime,
      endTime,
    });
  }

  return segments;
};
