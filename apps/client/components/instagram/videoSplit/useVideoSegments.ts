/**
 * @file useVideoSegments.ts
 * @description State hook for the video-split preview. Loads the source
 *              video metadata, derives initial segments from
 *              `splitOptions`, regenerates thumbnails when the *segment
 *              fingerprint* changes (length + aspectRatio + quality)
 *              instead of just the length, and exposes playback helpers.
 * @hook useVideoSegments
 * @layer infrastructure
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  type VideoMetadata,
  type VideoSplitOptions,
} from "@providers/instagram/src/mediaProcessor";
import type { PreviewSegment } from "./types";

interface UseVideoSegmentsOptions {
  videoFile: File;
  videoUrl: string;
  splitOptions: VideoSplitOptions;
  onSegmentsGenerated?: (segments: PreviewSegment[]) => void;
}

interface UseVideoSegmentsResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoMetadata: VideoMetadata | null;
  segments: PreviewSegment[];
  isProcessing: boolean;
  progress: number;
  currentPreviewIndex: number;
  isPlaying: boolean;
  playSegment: (index: number) => void;
  pausePlayback: () => void;
  setIsPlaying: (playing: boolean) => void;
}

export function useVideoSegments({
  videoFile,
  videoUrl,
  splitOptions,
  onSegmentsGenerated,
}: UseVideoSegmentsOptions): UseVideoSegmentsResult {
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [segments, setSegments] = useState<PreviewSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generateInitialSegments = useCallback(
    (metadata: VideoMetadata) => {
      const totalDuration = metadata.duration;
      const segmentLength = splitOptions.segmentLength || 15;
      const maxSegments = splitOptions.maxSegments || 100;
      const segmentCount = Math.min(Math.ceil(totalDuration / segmentLength), maxSegments);
      const newSegments: PreviewSegment[] = [];
      for (let i = 0; i < segmentCount; i++) {
        const startTime = i * segmentLength;
        const endTime = Math.min(startTime + segmentLength, totalDuration);
        newSegments.push({
          id: `segment-${i}`,
          url: `${videoUrl}#t=${startTime},${endTime}`,
          duration: endTime - startTime,
          sequence: i + 1,
          startTime,
          endTime,
          isGenerating: false,
        });
      }
      setSegments(newSegments);
      onSegmentsGenerated?.(newSegments);
    },
    [splitOptions, videoUrl, onSegmentsGenerated]
  );

  // Load video metadata once on mount / file change.
  useEffect(() => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const metadata: VideoMetadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        format: videoFile.type,
        bitrate: 0,
        frameRate: 30,
      };
      setVideoMetadata(metadata);
      generateInitialSegments(metadata);
    };
    video.src = videoUrl;
  }, [videoFile, videoUrl, generateInitialSegments]);

  // Regenerate segments when split options change.
  useEffect(() => {
    if (videoMetadata) {
      generateInitialSegments(videoMetadata);
    }
  }, [splitOptions, videoMetadata, generateInitialSegments]);

  const generateThumbnails = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 270;
    canvas.height = 480;

    const updatedSegments = [...segments];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;
      try {
        video.currentTime = segment.startTime + 1;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvas.width / canvas.height;
            let drawWidth: number;
            let drawHeight: number;
            let drawX: number;
            let drawY: number;
            if (videoAspect > canvasAspect) {
              drawHeight = canvas.height;
              drawWidth = drawHeight * videoAspect;
              drawX = (canvas.width - drawWidth) / 2;
              drawY = 0;
            } else {
              drawWidth = canvas.width;
              drawHeight = drawWidth / videoAspect;
              drawX = 0;
              drawY = (canvas.height - drawHeight) / 2;
            }
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
            const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
            updatedSegments[i] = { ...segment, thumbnail: thumbnailUrl, isGenerating: false };
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
        });
        setProgress(((i + 1) / segments.length) * 100);
        setSegments([...updatedSegments]);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        updatedSegments[i] = { ...segment, isGenerating: false };
      }
    }
    setSegments(updatedSegments);
    setIsProcessing(false);
    setProgress(0);
  }, [segments]);

  // Auto-regenerate thumbnails whenever the *fingerprint* of the segment
  // set changes — count + aspect + quality. Using `segments.length` alone
  // missed cases where the count was identical but aspectRatio or quality
  // changed; using `segments` would re-trigger on every state update.
  const segmentFingerprint = useMemo(
    () => `${segments.length}-${splitOptions.aspectRatio}-${splitOptions.quality}`,
    [segments.length, splitOptions.aspectRatio, splitOptions.quality]
  );
  useEffect(() => {
    if (segments.length > 0 && videoRef.current) {
      generateThumbnails();
    }
    // Deliberately keyed on `segmentFingerprint` only. `generateThumbnails`
    // closes over `segments`; including it here would create an update
    // loop because the function reference changes every render. The
    // fingerprint captures the cases that should re-trigger thumbnails
    // (count + aspect + quality) and ignores incidental array-identity
    // churn.
  }, [segmentFingerprint, generateThumbnails]);

  const playSegment = useCallback(
    (index: number) => {
      if (!videoRef.current) return;
      const segment = segments[index];
      if (!segment) return;
      const video = videoRef.current;
      video.currentTime = segment.startTime;
      setCurrentPreviewIndex(index);
      setIsPlaying(true);
      video.play();
      const checkEnd = () => {
        if (video.currentTime >= segment.endTime) {
          video.pause();
          setIsPlaying(false);
          video.removeEventListener("timeupdate", checkEnd);
        }
      };
      video.addEventListener("timeupdate", checkEnd);
    },
    [segments]
  );

  const pausePlayback = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  return {
    videoRef,
    canvasRef,
    videoMetadata,
    segments,
    isProcessing,
    progress,
    currentPreviewIndex,
    isPlaying,
    playSegment,
    pausePlayback,
    setIsPlaying,
  };
}
