"use client";

/**
 * @file VideoSplitPreview.tsx
 * @description Modal that previews how an Instagram video will be split
 *              into Stories segments. Composes `useVideoSegments` (state
 *              + thumbnail generation) with the `SplitSettingsPanel` and
 *              `SegmentsGrid` presentational subs.
 * @component VideoSplitPreview
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { type VideoSegment, type VideoSplitOptions } from "@providers/instagram/src/mediaProcessor";
import { SegmentsGrid } from "./videoSplit/SegmentsGrid";
import { SplitSettingsPanel } from "./videoSplit/SplitSettingsPanel";
import { useVideoSegments } from "./videoSplit/useVideoSegments";

interface VideoSplitPreviewProps {
  videoFile: File;
  videoUrl: string;
  splitOptions: VideoSplitOptions;
  onOptionsChange: (options: VideoSplitOptions) => void;
  onSegmentsGenerated: (segments: VideoSegment[]) => void;
  onClose: () => void;
  onApply: (segments: VideoSegment[]) => void;
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
  const t = useTranslations("instagram.components");
  const {
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
  } = useVideoSegments({
    videoFile,
    videoUrl,
    splitOptions,
    onSegmentsGenerated,
  });

  const totalSegmentDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-6xl max-h-[90vh] overflow-hidden flex flex-col w-full">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{t("videoSplit.title")}</h2>
            <p className="text-gray-600 mt-1">{t("videoSplit.subtitle")}</p>
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
          <SplitSettingsPanel
            videoFile={videoFile}
            videoMetadata={videoMetadata}
            splitOptions={splitOptions}
            segments={segments}
            onOptionsChange={onOptionsChange}
          />

          <div className="flex-1 flex flex-col">
            <div className="p-6 border-b">
              <div className="flex items-center justify-center">
                <div className="relative">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-72 h-128 object-cover rounded-2xl bg-black"
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                  >
                    {/* Captions intentionally absent: this is a preview of user-uploaded
                        media with no caption track yet. Placeholder track declares intent. */}
                    <track kind="captions" />
                  </video>

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

                  {segments[currentPreviewIndex] && (
                    <div className="absolute top-4 left-4 right-4 text-center">
                      <div className="bg-black/50 text-white text-sm px-3 py-1 rounded-full">
                        {t("videoSplit.segmentOf", {
                          current: currentPreviewIndex + 1,
                          total: segments.length,
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <SegmentsGrid
              segments={segments}
              currentPreviewIndex={currentPreviewIndex}
              isProcessing={isProcessing}
              progress={progress}
              onPlay={playSegment}
            />
          </div>
        </div>

        <div className="p-6 border-t bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {segments.length > 0 && (
              <>
                {t("videoSplit.summary", {
                  count: segments.length,
                  duration: totalSegmentDuration.toFixed(1),
                })}
              </>
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              {t("videoSplit.cancel")}
            </button>
            <button
              onClick={() => onApply(segments)}
              disabled={segments.length === 0 || isProcessing}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {t("videoSplit.applySplit", { count: segments.length })}
            </button>
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
