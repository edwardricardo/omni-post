/**
 * @file SegmentsGrid.tsx
 * @description Grid of preview segments rendered below the video player.
 *              Each tile shows the canvas thumbnail (or a spinner while
 *              generating, or a play icon as fallback) plus the segment
 *              number, duration, and start–end timestamp range. Click /
 *              keyboard activates `onPlay(index)` on the host.
 * @component SegmentsGrid
 * @layer infrastructure
 */

import { formatTime } from "../utils";
import type { PreviewSegment } from "./types";

interface SegmentsGridProps {
  segments: PreviewSegment[];
  currentPreviewIndex: number;
  isProcessing: boolean;
  progress: number;
  onPlay: (index: number) => void;
}

export function SegmentsGrid({
  segments,
  currentPreviewIndex,
  isProcessing,
  progress,
  onPlay,
}: SegmentsGridProps) {
  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Preview Segments ({segments.length})</h3>
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
            role="button"
            tabIndex={0}
            aria-label={`Play segment ${index + 1}`}
            aria-pressed={index === currentPreviewIndex}
            className={`relative border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
              index === currentPreviewIndex
                ? "border-blue-500 shadow-lg"
                : "border-gray-200 hover:border-gray-300"
            }`}
            onClick={() => onPlay(index)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPlay(index);
              }
            }}
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

              <div className="absolute top-2 left-2 bg-black/75 text-white text-xs px-2 py-1 rounded-sm">
                {index + 1}
              </div>

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
  );
}
