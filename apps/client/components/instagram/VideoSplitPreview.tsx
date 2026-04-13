"use client";

/**
 * @file VideoSplitPreview.tsx
 * @component VideoSplitPreview
 * @description Video splitting preview component for Instagram Stories, allowing users to
 * configure split options, preview individual segments, and apply the split before upload.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  VideoSegment,
  VideoSplitOptions,
  VideoMetadata,
} from "@providers/instagram/src/mediaProcessor";

interface VideoSplitPreviewProps {
  videoFile: File;
  videoUrl: string;
  splitOptions: VideoSplitOptions;
  onOptionsChange: (options: VideoSplitOptions) => void;
  onSegmentsGenerated: (segments: VideoSegment[]) => void;
  onClose: () => void;
  onApply: (segments: VideoSegment[]) => void;
}

interface PreviewSegment extends VideoSegment {
  thumbnail?: string;
  isGenerating?: boolean;
  progress?: number;
}

export function VideoSplitPreview({
  videoFile,
  videoUrl,
  splitOptions,
  onOptionsChange,
  onSegmentsGenerated,
  onClose,
  onApply,
}: VideoSplitPreviewProps) {
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [segments, setSegments] = useState<PreviewSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const _timelineRef = useRef<HTMLDivElement>(null);

  // Generate initial segments based on options
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
      onSegmentsGenerated(newSegments);
    },
    [splitOptions, videoUrl, onSegmentsGenerated]
  );

  // Load video metadata
  useEffect(() => {
    const loadMetadata = () => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const metadata: VideoMetadata = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          format: videoFile.type,
          bitrate: 0, // Will be estimated
          frameRate: 30, // Default estimation
        };
        setVideoMetadata(metadata);
        generateInitialSegments(metadata);
      };
      video.src = videoUrl;
    };

    loadMetadata();
  }, [videoFile, videoUrl, generateInitialSegments]);

  // Regenerate segments when options change
  useEffect(() => {
    if (videoMetadata) {
      generateInitialSegments(videoMetadata);
    }
  }, [splitOptions, videoMetadata, generateInitialSegments]);

  // Generate thumbnails for segments
  const generateThumbnails = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    // Set canvas size to match Stories aspect ratio (9:16)
    canvas.width = 270;
    canvas.height = 480;

    const updatedSegments = [...segments];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue; // Skip if segment is undefined

      try {
        // Seek to segment start time
        video.currentTime = segment.startTime + 1; // 1 second into segment for better thumbnail

        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);

            // Draw video frame to canvas
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvas.width / canvas.height;

            let drawWidth, drawHeight, drawX, drawY;

            if (videoAspect > canvasAspect) {
              // Video is wider than canvas
              drawHeight = canvas.height;
              drawWidth = drawHeight * videoAspect;
              drawX = (canvas.width - drawWidth) / 2;
              drawY = 0;
            } else {
              // Video is taller than canvas
              drawWidth = canvas.width;
              drawHeight = drawWidth / videoAspect;
              drawX = 0;
              drawY = (canvas.height - drawHeight) / 2;
            }

            // Clear canvas and draw video frame
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);

            // Generate thumbnail data URL
            const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
            updatedSegments[i] = { ...segment, thumbnail: thumbnailUrl, isGenerating: false };

            resolve();
          };

          video.addEventListener("seeked", onSeeked);
        });

        // Update progress
        setProgress(((i + 1) / segments.length) * 100);
        setSegments([...updatedSegments]);

        // Small delay to prevent overwhelming the browser
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        // Thumbnail generation failed — segment will show without preview
        updatedSegments[i] = { ...segment, isGenerating: false };
      }
    }

    setSegments(updatedSegments);
    setIsProcessing(false);
    setProgress(0);
  }, [segments]);

  // Auto-generate thumbnails when segments change
  useEffect(() => {
    if (segments.length > 0 && videoRef.current) {
      generateThumbnails();
    }
  }, [segments.length, generateThumbnails]); // Only trigger when segments count changes

  // Video playback controls
  const playSegment = useCallback(
    (index: number) => {
      if (!videoRef.current) return;

      const segment = segments[index];
      if (!segment) return; // Guard against undefined segment

      const video = videoRef.current;

      video.currentTime = segment.startTime;
      setCurrentPreviewIndex(index);
      setIsPlaying(true);
      video.play();

      // Stop playback at segment end
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

  const handleSegmentLengthChange = useCallback(
    (newLength: number) => {
      onOptionsChange({
        ...splitOptions,
        segmentLength: newLength,
      });
    },
    [splitOptions, onOptionsChange]
  );

  const handleMaxSegmentsChange = useCallback(
    (maxSegments: number) => {
      onOptionsChange({
        ...splitOptions,
        maxSegments,
      });
    },
    [splitOptions, onOptionsChange]
  );

  const handleQualityChange = useCallback(
    (quality: "low" | "medium" | "high") => {
      onOptionsChange({
        ...splitOptions,
        quality,
      });
    },
    [splitOptions, onOptionsChange]
  );

  const handleTransitionsChange = useCallback(
    (addTransitions: boolean) => {
      onOptionsChange({
        ...splitOptions,
        addTransitions,
      });
    },
    [splitOptions, onOptionsChange]
  );

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-6xl max-h-[90vh] overflow-hidden flex flex-col w-full">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Video Split Preview</h2>
            <p className="text-gray-600 mt-1">
              Configure how your video will be split into Instagram Stories
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Settings Panel */}
          <div className="w-80 bg-gray-50 p-6 overflow-y-auto">
            <h3 className="font-semibold text-gray-900 mb-4">Split Settings</h3>

            {/* Video Info */}
            {videoMetadata && (
              <div className="mb-6 p-4 bg-white rounded-lg border">
                <h4 className="font-medium text-gray-900 mb-2">Video Information</h4>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Duration:</span>
                    <span>{formatTime(videoMetadata.duration)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Size:</span>
                    <span>{formatFileSize(videoFile.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolution:</span>
                    <span>
                      {videoMetadata.width}×{videoMetadata.height}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Format:</span>
                    <span>{videoMetadata.format}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Segment Length */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Segment Length: {splitOptions.segmentLength}s
              </label>
              <input
                type="range"
                min="5"
                max="15"
                step="1"
                value={splitOptions.segmentLength}
                onChange={(e) => handleSegmentLengthChange(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>5s</span>
                <span>15s</span>
              </div>
            </div>

            {/* Max Segments */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Segments: {splitOptions.maxSegments}
              </label>
              <input
                type="range"
                min="1"
                max="50"
                value={splitOptions.maxSegments}
                onChange={(e) => handleMaxSegmentsChange(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1</span>
                <span>50</span>
              </div>
            </div>

            {/* Quality */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Quality</label>
              <select
                value={splitOptions.quality}
                onChange={(e) => handleQualityChange(e.target.value as "low" | "medium" | "high")}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="high">High (Best quality, larger files)</option>
                <option value="medium">Medium (Balanced)</option>
                <option value="low">Low (Smaller files, faster upload)</option>
              </select>
            </div>

            {/* Aspect Ratio */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Aspect Ratio</label>
              <select
                value={splitOptions.aspectRatio}
                onChange={(e) =>
                  onOptionsChange({
                    ...splitOptions,
                    aspectRatio: e.target.value as "9:16" | "1:1" | "16:9",
                  })
                }
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="9:16">9:16 (Stories)</option>
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Landscape)</option>
              </select>
            </div>

            {/* Transitions */}
            <div className="mb-6">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={splitOptions.addTransitions || false}
                  onChange={(e) => handleTransitionsChange(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Add fade transitions</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">Smooth transitions between segments</p>
            </div>

            {/* Results Summary */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">Split Results</h4>
              <div className="space-y-1 text-sm text-blue-800">
                <div>Segments: {segments.length}</div>
                <div>
                  Avg duration:{" "}
                  {segments.length > 0
                    ? (segments.reduce((sum, s) => sum + s.duration, 0) / segments.length).toFixed(
                        1
                      )
                    : 0}
                  s
                </div>
                {videoMetadata && (
                  <div>
                    Coverage:{" "}
                    {(
                      (segments.reduce((sum, s) => sum + s.duration, 0) / videoMetadata.duration) *
                      100
                    ).toFixed(0)}
                    %
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Preview Area */}
          <div className="flex-1 flex flex-col">
            {/* Video Player */}
            <div className="p-6 border-b">
              <div className="flex items-center justify-center">
                <div className="relative">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-72 h-128 object-cover rounded-2xl bg-black"
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                  />

                  {/* Play/Pause Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={() =>
                        isPlaying ? pausePlayback() : playSegment(currentPreviewIndex)
                      }
                      className="bg-black/50 text-white p-4 rounded-full hover:bg-black/70 transition-colors"
                    >
                      {isPlaying ? (
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                      ) : (
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Segment Info Overlay */}
                  {segments[currentPreviewIndex] && (
                    <div className="absolute top-4 left-4 right-4 text-center">
                      <div className="bg-black/50 text-white text-sm px-3 py-1 rounded-full">
                        Segment {currentPreviewIndex + 1} of {segments.length}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Segments Grid */}
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">
                  Preview Segments ({segments.length})
                </h3>
                {isProcessing && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <span>Generating thumbnails... {progress.toFixed(0)}%</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {segments.map((segment, index) => (
                  <div
                    key={segment.id}
                    className={`relative border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
                      index === currentPreviewIndex
                        ? "border-blue-500 shadow-lg"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => playSegment(index)}
                  >
                    <div className="aspect-[9/16] bg-gray-100 relative">
                      {segment.thumbnail ? (
                        <img
                          src={segment.thumbnail}
                          alt={`Segment ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : segment.isGenerating ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      )}

                      {/* Segment Number */}
                      <div className="absolute top-2 left-2 bg-black/75 text-white text-xs px-2 py-1 rounded-sm">
                        {index + 1}
                      </div>

                      {/* Duration */}
                      <div className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded-sm">
                        {segment.duration.toFixed(1)}s
                      </div>
                    </div>

                    <div className="p-2">
                      <div className="text-xs text-gray-600 text-center">
                        {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {segments.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-4">🎬</div>
                  <div>Generating segments...</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {segments.length > 0 && (
              <>
                {segments.length} segments will be created • Total duration:{" "}
                {segments.reduce((sum, s) => sum + s.duration, 0).toFixed(1)}s
              </>
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(segments)}
              disabled={segments.length === 0 || isProcessing}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Apply Split ({segments.length} segments)
            </button>
          </div>
        </div>

        {/* Hidden canvas for thumbnail generation */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
