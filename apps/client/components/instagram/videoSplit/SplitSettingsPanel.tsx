/**
 * @file SplitSettingsPanel.tsx
 * @description Left-hand sidebar of the video-split modal. Renders the
 *              source-video summary plus the four configurable settings
 *              (segment length, max segments, quality, aspect ratio,
 *              transitions). Pure presentational — option mutations are
 *              forwarded to the host via `onOptionsChange`.
 * @component SplitSettingsPanel
 * @layer infrastructure
 */

import { useId } from "react";
import type { VideoMetadata, VideoSplitOptions } from "@providers/instagram/src/mediaProcessor";
import { formatFileSize, formatTime } from "../utils";
import type { PreviewSegment } from "./types";

interface SplitSettingsPanelProps {
  videoFile: File;
  videoMetadata: VideoMetadata | null;
  splitOptions: VideoSplitOptions;
  segments: PreviewSegment[];
  onOptionsChange: (options: VideoSplitOptions) => void;
}

export function SplitSettingsPanel({
  videoFile,
  videoMetadata,
  splitOptions,
  segments,
  onOptionsChange,
}: SplitSettingsPanelProps) {
  const segmentLengthId = useId();
  const maxSegmentsId = useId();
  const qualityId = useId();
  const aspectRatioId = useId();

  const handleSegmentLengthChange = (newLength: number) => {
    onOptionsChange({ ...splitOptions, segmentLength: newLength });
  };
  const handleMaxSegmentsChange = (maxSegments: number) => {
    onOptionsChange({ ...splitOptions, maxSegments });
  };
  const handleQualityChange = (quality: "low" | "medium" | "high") => {
    onOptionsChange({ ...splitOptions, quality });
  };
  const handleTransitionsChange = (addTransitions: boolean) => {
    onOptionsChange({ ...splitOptions, addTransitions });
  };

  const totalSegmentDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const avgDuration = segments.length > 0 ? totalSegmentDuration / segments.length : 0;

  return (
    <div className="w-80 bg-gray-50 p-6 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">Split Settings</h3>

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

      <div className="mb-6">
        <label htmlFor={segmentLengthId} className="block text-sm font-medium text-gray-700 mb-2">
          Segment Length: {splitOptions.segmentLength}s
        </label>
        <input
          id={segmentLengthId}
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

      <div className="mb-6">
        <label htmlFor={maxSegmentsId} className="block text-sm font-medium text-gray-700 mb-2">
          Max Segments: {splitOptions.maxSegments}
        </label>
        <input
          id={maxSegmentsId}
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

      <div className="mb-6">
        <label htmlFor={qualityId} className="block text-sm font-medium text-gray-700 mb-2">
          Quality
        </label>
        <select
          id={qualityId}
          value={splitOptions.quality}
          onChange={(e) => handleQualityChange(e.target.value as "low" | "medium" | "high")}
          className="w-full px-3 py-2 border rounded-lg"
        >
          <option value="high">High (Best quality, larger files)</option>
          <option value="medium">Medium (Balanced)</option>
          <option value="low">Low (Smaller files, faster upload)</option>
        </select>
      </div>

      <div className="mb-6">
        <label htmlFor={aspectRatioId} className="block text-sm font-medium text-gray-700 mb-2">
          Aspect Ratio
        </label>
        <select
          id={aspectRatioId}
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

      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h4 className="font-medium text-blue-900 mb-2">Split Results</h4>
        <div className="space-y-1 text-sm text-blue-800">
          <div>Segments: {segments.length}</div>
          <div>Avg duration: {avgDuration.toFixed(1)}s</div>
          {videoMetadata && (
            <div>
              Coverage: {((totalSegmentDuration / videoMetadata.duration) * 100).toFixed(0)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
