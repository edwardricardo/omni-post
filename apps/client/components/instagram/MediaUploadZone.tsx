"use client";

/**
 * @file MediaUploadZone.tsx
 * @description Drag-and-drop media upload zone for Instagram. Composes the
 *              `useMediaUpload` state hook with the presentational `DropZone`
 *              and `UploadedFileCard` plus the `VideoSplitPreview` modal.
 *              All processing logic — validation, metadata extraction,
 *              thumbnail generation — lives in the hook + utils package.
 * @component MediaUploadZone
 * @layer infrastructure
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";
import { VideoSplitPreview } from "./VideoSplitPreview";
import { VideoSplitOptions, VideoSegment } from "@providers/instagram/src/mediaProcessor";
import { DropZone } from "./uploadZone/DropZone";
import { UploadedFileCard } from "./uploadZone/UploadedFileCard";
import { useMediaUpload } from "./uploadZone/useMediaUpload";
import type { MediaFile } from "./uploadZone/types";

interface MediaUploadZoneProps {
  onFilesAdded: (files: MediaFile[]) => void;
  onFileRemoved: (fileId: string) => void;
  onVideoSplit: (originalFile: MediaFile, segments: VideoSegment[]) => void;
  maxFiles?: number;
  acceptedTypes?: string[];
  maxFileSize?: number;
  className?: string;
}

const DEFAULT_SPLIT_OPTIONS: VideoSplitOptions = {
  segmentLength: 15,
  maxSegments: 20,
  aspectRatio: "9:16",
  quality: "high",
  addTransitions: false,
};

export function MediaUploadZone({
  onFilesAdded,
  onFileRemoved,
  onVideoSplit,
  maxFiles = 20,
  acceptedTypes = ["image/*", "video/*"],
  maxFileSize = 100,
  className = "",
}: MediaUploadZoneProps) {
  const t = useTranslations("instagram.components");
  const [showVideoPreview, setShowVideoPreview] = useState<{
    file: MediaFile;
    options: VideoSplitOptions;
  } | null>(null);

  const handleValidationErrors = useCallback(
    (errors: string[]) => {
      toast({
        title: t("mediaUpload.filesRejected", { count: errors.length }),
        description: errors.join("\n"),
        variant: "destructive",
      });
    },
    [t]
  );

  const handleVideoNeedsSplit = useCallback((file: MediaFile) => {
    setShowVideoPreview({ file, options: DEFAULT_SPLIT_OPTIONS });
  }, []);

  const { uploadedFiles, isUploading, addFiles, removeFile } = useMediaUpload({
    acceptedTypes,
    maxFileSize,
    maxFiles,
    onError: handleValidationErrors,
    onFilesAdded,
    onVideoNeedsSplit: handleVideoNeedsSplit,
  });

  const handleRemove = useCallback(
    (fileId: string) => {
      removeFile(fileId);
      onFileRemoved(fileId);
    },
    [onFileRemoved, removeFile]
  );

  const handleRequestSplit = useCallback((file: MediaFile) => {
    setShowVideoPreview({ file, options: DEFAULT_SPLIT_OPTIONS });
  }, []);

  const handleVideoSplitApply = useCallback(
    (segments: VideoSegment[]) => {
      if (showVideoPreview) {
        onVideoSplit(showVideoPreview.file, segments);
        setShowVideoPreview(null);
      }
    },
    [showVideoPreview, onVideoSplit]
  );

  const handleSplitOptionsChange = useCallback((options: VideoSplitOptions) => {
    setShowVideoPreview((prev) => (prev ? { ...prev, options } : null));
  }, []);

  const showSplitButton = useMemo(() => true, []);

  return (
    <>
      <div className={`media-upload-zone ${className}`}>
        <DropZone
          acceptedTypes={acceptedTypes}
          maxFiles={maxFiles}
          maxFileSize={maxFileSize}
          isUploading={isUploading}
          onFiles={addFiles}
        />

        {uploadedFiles.length > 0 && (
          <div className="mt-6">
            <h3 className="font-medium text-gray-900 mb-4">
              {t("mediaUpload.uploadedFiles", { count: uploadedFiles.length })}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {uploadedFiles.map((file) => (
                <UploadedFileCard
                  key={file.id}
                  file={file}
                  showSplitButton={showSplitButton}
                  onRemove={handleRemove}
                  onRequestSplit={handleRequestSplit}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showVideoPreview && (
        <VideoSplitPreview
          videoFile={showVideoPreview.file.file}
          videoUrl={showVideoPreview.file.url}
          splitOptions={showVideoPreview.options}
          onOptionsChange={handleSplitOptionsChange}
          onSegmentsGenerated={() => {}}
          onClose={() => setShowVideoPreview(null)}
          onApply={handleVideoSplitApply}
        />
      )}
    </>
  );
}

export type { MediaFile } from "./uploadZone/types";
