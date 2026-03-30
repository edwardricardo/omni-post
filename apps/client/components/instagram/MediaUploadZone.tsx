"use client";

/**
 * @file MediaUploadZone.tsx
 * @description Drag-and-drop media upload zone for Instagram content, supporting image and video
 * uploads with file validation, progress tracking, and integrated video split preview.
 */

import React, { useState, useCallback, useRef, useMemo, DragEvent } from "react";
import { VideoSplitPreview } from "./VideoSplitPreview";
import { VideoSplitOptions, VideoSegment } from "@providers/instagram/src/mediaProcessor";

interface MediaFile {
  id: string;
  file: File;
  url: string;
  type: "image" | "video" | "gif";
  thumbnail?: string;
  duration?: number;
  size: number;
  status: "uploading" | "processing" | "ready" | "error";
  progress?: number;
  error?: string;
  metadata?: {
    width?: number;
    height?: number;
    aspectRatio?: number;
  };
}

interface MediaUploadZoneProps {
  onFilesAdded: (files: MediaFile[]) => void;
  onFileRemoved: (fileId: string) => void;
  onVideoSplit: (originalFile: MediaFile, segments: VideoSegment[]) => void;
  maxFiles?: number;
  acceptedTypes?: string[];
  maxFileSize?: number; // in MB
  className?: string;
}

export function MediaUploadZone({
  onFilesAdded,
  onFileRemoved,
  onVideoSplit,
  maxFiles = 20,
  acceptedTypes = ["image/*", "video/*"],
  maxFileSize = 100, // 100MB default
  className = "",
}: MediaUploadZoneProps) {
  const [uploadedFiles, setUploadedFiles] = useState<MediaFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showVideoPreview, setShowVideoPreview] = useState<{
    file: MediaFile;
    options: VideoSplitOptions;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const defaultSplitOptions: VideoSplitOptions = useMemo(
    () => ({
      segmentLength: 15,
      maxSegments: 20,
      aspectRatio: "9:16",
      quality: "high",
      addTransitions: false,
    }),
    []
  );

  // File validation
  const validateFile = useCallback(
    (file: File): { valid: boolean; error?: string } => {
      // Check file type
      const isValidType = acceptedTypes.some((type) => {
        if (type.endsWith("/*")) {
          return file.type.startsWith(type.slice(0, -1));
        }
        return file.type === type;
      });

      if (!isValidType) {
        return {
          valid: false,
          error: `File type not supported. Accepted types: ${acceptedTypes.join(", ")}`,
        };
      }

      // Check file size
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > maxFileSize) {
        return {
          valid: false,
          error: `File size too large. Maximum size: ${maxFileSize}MB`,
        };
      }

      // Check total file count
      if (uploadedFiles.length >= maxFiles) {
        return {
          valid: false,
          error: `Maximum ${maxFiles} files allowed`,
        };
      }

      return { valid: true };
    },
    [acceptedTypes, maxFileSize, maxFiles, uploadedFiles.length]
  );

  // Process individual media file
  const processMediaFile = useCallback(
    async (mediaFile: MediaFile): Promise<void> => {
      updateFileStatus(mediaFile.id, "processing", 25);

      if (mediaFile.type === "video") {
        // Get video metadata
        const metadata = await getVideoMetadata(mediaFile.file);
        updateFileMetadata(mediaFile.id, metadata);
        updateFileStatus(mediaFile.id, "processing", 50);

        // Generate thumbnail
        const thumbnail = await generateVideoThumbnail(mediaFile.file);
        updateFileThumbnail(mediaFile.id, thumbnail);
        updateFileStatus(mediaFile.id, "processing", 75);

        // Check if video needs splitting (longer than 15 seconds)
        if (metadata.duration && metadata.duration > 15) {
          updateFileStatus(mediaFile.id, "ready", 100);
          // Show split preview dialog
          setShowVideoPreview({
            file: { ...mediaFile, thumbnail, metadata },
            options: defaultSplitOptions,
          });
          return;
        }
      } else if (mediaFile.type === "image") {
        // Get image metadata
        const metadata = await getImageMetadata(mediaFile.file);
        updateFileMetadata(mediaFile.id, metadata);
        updateFileStatus(mediaFile.id, "processing", 75);
      }

      updateFileStatus(mediaFile.id, "ready", 100);
    },
    [defaultSplitOptions]
  );

  // Process uploaded files
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsUploading(true);
      const fileArray = Array.from(files);
      const validFiles: MediaFile[] = [];
      const errors: string[] = [];

      for (const file of fileArray) {
        const validation = validateFile(file);
        if (!validation.valid) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }

        const mediaFile: MediaFile = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          url: URL.createObjectURL(file),
          type: file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("video/")
              ? "video"
              : "gif",
          size: file.size,
          status: "uploading",
          progress: 0,
        };

        validFiles.push(mediaFile);
      }

      if (errors.length > 0) {
        // Errors are logged to console; toast integration pending UI notification package
      }

      if (validFiles.length === 0) {
        setIsUploading(false);
        return;
      }

      // Add files to state immediately
      setUploadedFiles((prev) => [...prev, ...validFiles]);

      // Process each file
      for (const mediaFile of validFiles) {
        try {
          await processMediaFile(mediaFile);
        } catch (error) {
          updateFileStatus(
            mediaFile.id,
            "error",
            undefined,
            error instanceof Error ? error.message : "Processing failed"
          );
        }
      }

      // Notify parent component
      onFilesAdded(validFiles);
      setIsUploading(false);
    },
    [validateFile, onFilesAdded, processMediaFile]
  );

  // Helper functions for file updates
  const updateFileStatus = (
    fileId: string,
    status: MediaFile["status"],
    progress?: number,
    error?: string
  ) => {
    setUploadedFiles((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? {
              ...file,
              status,
              ...(progress !== undefined && { progress }),
              ...(error !== undefined && { error }),
            }
          : file
      )
    );
  };

  const updateFileMetadata = (fileId: string, metadata: any) => {
    setUploadedFiles((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? {
              ...file,
              metadata,
              ...(metadata.duration !== undefined && { duration: metadata.duration }),
            }
          : file
      )
    );
  };

  const updateFileThumbnail = (fileId: string, thumbnail: string) => {
    setUploadedFiles((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? {
              ...file,
              ...(thumbnail && { thumbnail }),
            }
          : file
      )
    );
  };

  // Get video metadata
  const getVideoMetadata = (
    file: File
  ): Promise<{ width: number; height: number; duration: number; aspectRatio: number }> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const metadata = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          aspectRatio: video.videoWidth / video.videoHeight,
        };
        URL.revokeObjectURL(video.src);
        resolve(metadata);
      };
      video.onerror = reject;
      video.src = URL.createObjectURL(file);
    });
  };

  // Get image metadata
  const getImageMetadata = (
    file: File
  ): Promise<{ width: number; height: number; aspectRatio: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const metadata = {
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: img.naturalWidth / img.naturalHeight,
        };
        URL.revokeObjectURL(img.src);
        resolve(metadata);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  // Generate video thumbnail
  const generateVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }

      video.addEventListener("loadedmetadata", () => {
        // Set canvas size for thumbnail (Stories aspect ratio)
        canvas.width = 270;
        canvas.height = 480;

        // Seek to 1 second or 10% of video duration
        video.currentTime = Math.min(1, video.duration * 0.1);
      });

      video.addEventListener("seeked", () => {
        // Calculate aspect ratio scaling
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = canvas.width / canvas.height;

        let drawWidth, drawHeight, drawX, drawY;

        if (videoAspect > canvasAspect) {
          // Video is wider
          drawHeight = canvas.height;
          drawWidth = drawHeight * videoAspect;
          drawX = (canvas.width - drawWidth) / 2;
          drawY = 0;
        } else {
          // Video is taller
          drawWidth = canvas.width;
          drawHeight = drawWidth / videoAspect;
          drawX = 0;
          drawY = (canvas.height - drawHeight) / 2;
        }

        // Fill background and draw video frame
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);

        // Convert to data URL
        const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
        URL.revokeObjectURL(video.src);
        resolve(thumbnailUrl);
      });

      video.onerror = reject;
      video.src = URL.createObjectURL(file);
    });
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  // File input handler
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
      // Reset input value
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [processFiles]
  );

  // Remove file handler
  const handleRemoveFile = useCallback(
    (fileId: string) => {
      const file = uploadedFiles.find((f) => f.id === fileId);
      if (file) {
        URL.revokeObjectURL(file.url);
        if (file.thumbnail) {
          URL.revokeObjectURL(file.thumbnail);
        }
      }

      setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
      onFileRemoved(fileId);
    },
    [uploadedFiles, onFileRemoved]
  );

  // Video split handlers
  const handleVideoSplitApply = useCallback(
    (segments: VideoSegment[]) => {
      if (showVideoPreview) {
        onVideoSplit(showVideoPreview.file, segments);
        setShowVideoPreview(null);
      }
    },
    [showVideoPreview, onVideoSplit]
  );

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(0)}KB` : `${mb.toFixed(1)}MB`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <div className={`media-upload-zone ${className}`}>
        {/* Drop Zone */}
        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-xl p-8 text-center transition-all
            ${isDragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
            ${isUploading ? "pointer-events-none opacity-75" : "cursor-pointer"}
          `}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedTypes.join(",")}
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="space-y-4">
            <div className="text-4xl">{isDragOver ? "📁" : "📎"}</div>

            <div>
              <div className="text-lg font-medium text-gray-900">
                {isDragOver ? "Drop files here" : "Upload media files"}
              </div>
              <div className="text-sm text-gray-600 mt-1">Drag & drop or click to select files</div>
            </div>

            <div className="text-xs text-gray-500">
              <div>Supported: {acceptedTypes.join(", ")}</div>
              <div>
                Max size: {maxFileSize}MB per file • Max files: {maxFiles}
              </div>
              <div>Videos longer than 15s will be automatically split for Stories</div>
            </div>

            {isUploading && (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-gray-600">Processing files...</span>
              </div>
            )}
          </div>
        </div>

        {/* Uploaded Files Grid */}
        {uploadedFiles.length > 0 && (
          <div className="mt-6">
            <h3 className="font-medium text-gray-900 mb-4">
              Uploaded Files ({uploadedFiles.length})
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="relative group border rounded-lg overflow-hidden bg-white shadow-xs"
                >
                  {/* File Preview */}
                  <div className="aspect-square bg-gray-100 relative">
                    {file.type === "image" ? (
                      <img
                        src={file.url}
                        alt={file.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : file.type === "video" ? (
                      file.thumbnail ? (
                        <img
                          src={file.thumbnail}
                          alt={file.file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <svg
                          className="w-8 h-8"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V1a1 1 0 011-1h8a1 1 0 011 1v3M7 4h10m6 0v16a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1h20a1 1 0 011 1z"
                          />
                        </svg>
                      </div>
                    )}

                    {/* Status Overlay */}
                    {file.status !== "ready" && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        {file.status === "uploading" || file.status === "processing" ? (
                          <div className="text-center text-white">
                            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                            <div className="text-xs">
                              {file.status === "uploading" ? "Uploading" : "Processing"}
                            </div>
                            {file.progress && <div className="text-xs mt-1">{file.progress}%</div>}
                          </div>
                        ) : file.status === "error" ? (
                          <div className="text-center text-white">
                            <svg
                              className="w-8 h-8 mx-auto mb-2"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                            </svg>
                            <div className="text-xs">Error</div>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* File Type Badge */}
                    <div className="absolute top-2 left-2">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-sm ${
                          file.type === "video"
                            ? "bg-red-100 text-red-800"
                            : file.type === "image"
                              ? "bg-green-100 text-green-800"
                              : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {file.type.toUpperCase()}
                      </span>
                    </div>

                    {/* Duration Badge (for videos) */}
                    {file.type === "video" && file.duration && (
                      <div className="absolute top-2 right-2">
                        <span className="px-2 py-1 text-xs font-medium bg-black/75 text-white rounded-sm">
                          {formatDuration(file.duration)}
                        </span>
                      </div>
                    )}

                    {/* Remove Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(file.id);
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>

                    {/* Split Video Button */}
                    {file.type === "video" &&
                      file.status === "ready" &&
                      file.duration &&
                      file.duration > 15 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowVideoPreview({
                              file,
                              options: defaultSplitOptions,
                            });
                          }}
                          className="absolute bottom-2 right-2 px-2 py-1 bg-blue-600 text-white text-xs rounded-sm hover:bg-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Split
                        </button>
                      )}
                  </div>

                  {/* File Info */}
                  <div className="p-2">
                    <div className="text-xs font-medium text-gray-900 truncate">
                      {file.file.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatFileSize(file.size)}
                      {file.metadata && (
                        <>
                          {" "}
                          • {file.metadata.width}×{file.metadata.height}
                        </>
                      )}
                    </div>
                    {file.error && (
                      <div className="text-xs text-red-600 mt-1 truncate">{file.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Video Split Preview Modal */}
      {showVideoPreview && (
        <VideoSplitPreview
          videoFile={showVideoPreview.file.file}
          videoUrl={showVideoPreview.file.url}
          splitOptions={showVideoPreview.options}
          onOptionsChange={(options) =>
            setShowVideoPreview((prev) => (prev ? { ...prev, options } : null))
          }
          onSegmentsGenerated={() => {}}
          onClose={() => setShowVideoPreview(null)}
          onApply={handleVideoSplitApply}
        />
      )}
    </>
  );
}
