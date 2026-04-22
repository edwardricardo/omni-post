/**
 * @file page.tsx
 * @description Instagram media upload page for processing images and videos before publishing.
 * Handles file selection, validation, processing progress, and video segment extraction.
 */
"use client";

import React, { useState, useCallback } from "react";
import { MediaUploadZone } from "@/components/instagram";
import { VideoSegment } from "@providers/instagram/src/mediaProcessor";

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

interface ProcessedVideo {
  originalFile: MediaFile;
  segments: VideoSegment[];
  createdAt: Date;
}

/**
 * @component InstagramUploadPage
 * @description Handles Instagram media upload with file selection, validation, processing progress, and video segment extraction.
 */
export default function InstagramUploadPage() {
  const [uploadedFiles, setUploadedFiles] = useState<MediaFile[]>([]);
  const [processedVideos, setProcessedVideos] = useState<ProcessedVideo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  // Handle files added to upload zone
  const handleFilesAdded = useCallback((files: MediaFile[]) => {
    setUploadedFiles((prev) => [...prev, ...files]);
  }, []);

  // Handle file removed from upload zone
  const handleFileRemoved = useCallback((fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  // Handle video split into segments
  const handleVideoSplit = useCallback((originalFile: MediaFile, segments: VideoSegment[]) => {
    const processedVideo: ProcessedVideo = {
      originalFile,
      segments,
      createdAt: new Date(),
    };

    setProcessedVideos((prev) => [...prev, processedVideo]);
  }, []);

  // Handle file selection for batch operations
  const handleFileSelect = useCallback((fileId: string, selected: boolean) => {
    setSelectedFiles((prev) => (selected ? [...prev, fileId] : prev.filter((id) => id !== fileId)));
  }, []);

  // Batch operations
  const handleSelectAll = useCallback(() => {
    setSelectedFiles(uploadedFiles.map((f) => f.id));
  }, [uploadedFiles]);

  const handleDeselectAll = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const handleBatchRemove = useCallback(() => {
    selectedFiles.forEach((fileId) => {
      handleFileRemoved(fileId);
    });
    setSelectedFiles([]);
  }, [selectedFiles, handleFileRemoved]);

  const handleCreateStories = useCallback(() => {
    const _selectedFileObjects = uploadedFiles.filter((f) => selectedFiles.includes(f.id));
    // Navigation to Stories editor with selected files pending router integration
  }, [uploadedFiles, selectedFiles]);

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(0)}KB` : `${mb.toFixed(1)}MB`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getTotalFileSize = () => {
    return uploadedFiles.reduce((total, file) => total + file.size, 0);
  };

  const getFileTypeStats = () => {
    const stats = { images: 0, videos: 0, total: uploadedFiles.length };
    uploadedFiles.forEach((file) => {
      if (file.type === "image") stats.images++;
      else if (file.type === "video") stats.videos++;
    });
    return stats;
  };

  const stats = getFileTypeStats();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Instagram Media Upload</h1>
          <p className="text-gray-600 mt-2">
            Upload and process images and videos for Instagram Stories, Reels, and Feed posts
          </p>
        </div>

        {/* Stats Bar */}
        {uploadedFiles.length > 0 && (
          <div className="bg-white rounded-lg border p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div className="text-sm">
                  <span className="font-medium text-gray-900">{stats.total}</span>
                  <span className="text-gray-600"> files</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium text-gray-900">{stats.images}</span>
                  <span className="text-gray-600"> images</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium text-gray-900">{stats.videos}</span>
                  <span className="text-gray-600"> videos</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium text-gray-900">
                    {formatFileSize(getTotalFileSize())}
                  </span>
                  <span className="text-gray-600"> total size</span>
                </div>
                {processedVideos.length > 0 && (
                  <div className="text-sm">
                    <span className="font-medium text-gray-900">{processedVideos.length}</span>
                    <span className="text-gray-600"> processed videos</span>
                  </div>
                )}
              </div>

              {/* Batch Actions */}
              {selectedFiles.length > 0 && (
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-600">{selectedFiles.length} selected</span>
                  <button
                    onClick={handleCreateStories}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                  >
                    Create Stories
                  </button>
                  <button
                    onClick={handleBatchRemove}
                    className="px-3 py-1 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                  >
                    Remove Selected
                  </button>
                  <button
                    onClick={handleDeselectAll}
                    className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                  >
                    Deselect All
                  </button>
                </div>
              )}

              {uploadedFiles.length > 0 && selectedFiles.length === 0 && (
                <button
                  onClick={handleSelectAll}
                  className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                >
                  Select All
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upload Zone */}
          <div className="lg:col-span-2">
            <MediaUploadZone
              onFilesAdded={handleFilesAdded}
              onFileRemoved={handleFileRemoved}
              onVideoSplit={handleVideoSplit}
              maxFiles={50}
              maxFileSize={500} // 500MB for large video files
              className="h-full"
            />

            {/* Uploaded Files Grid with Selection */}
            {uploadedFiles.length > 0 && (
              <div className="mt-8">
                <h3 className="font-medium text-gray-900 mb-4">
                  Uploaded Files ({uploadedFiles.length})
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.id}
                      className={`relative group border-2 rounded-lg overflow-hidden bg-white transition-all cursor-pointer ${
                        selectedFiles.includes(file.id)
                          ? "border-blue-500 ring-2 ring-blue-200"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => handleFileSelect(file.id, !selectedFiles.includes(file.id))}
                    >
                      {/* Selection Checkbox */}
                      <div className="absolute top-2 left-2 z-10">
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(file.id)}
                          onChange={(e) => handleFileSelect(file.id, e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-white border-2 border-gray-300 rounded-sm focus:ring-blue-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>

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
                                d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2"
                              />
                            </svg>
                          </div>
                        )}

                        {/* Status Indicators */}
                        {file.status !== "ready" && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            {file.status === "uploading" || file.status === "processing" ? (
                              <div className="text-center text-white">
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-1"></div>
                                <div className="text-xs">{file.progress}%</div>
                              </div>
                            ) : file.status === "error" ? (
                              <div className="text-center text-white">
                                <svg
                                  className="w-6 h-6 mx-auto mb-1"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                                </svg>
                                <div className="text-xs">Error</div>
                              </div>
                            ) : null}
                          </div>
                        )}

                        {/* File Type & Duration */}
                        <div className="absolute top-2 right-2 space-y-1">
                          <span
                            className={`px-1.5 py-0.5 text-xs font-medium rounded-sm ${
                              file.type === "video"
                                ? "bg-red-100 text-red-800"
                                : file.type === "image"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {file.type.toUpperCase()}
                          </span>
                          {file.type === "video" && file.duration && (
                            <div className="block">
                              <span className="px-1.5 py-0.5 text-xs font-medium bg-black/75 text-white rounded-sm">
                                {formatDuration(file.duration)}
                              </span>
                            </div>
                          )}
                        </div>
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
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar - Processing Results */}
          <div className="space-y-6">
            {/* Processing Queue */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-medium text-gray-900 mb-3">Processing Status</h3>

              {uploadedFiles.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <svg
                    className="w-8 h-8 mx-auto mb-2 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div className="text-sm">No files uploaded yet</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {uploadedFiles.slice(-5).map((file) => (
                    <div key={file.id} className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-sm overflow-hidden flex-shrink-0">
                        {file.thumbnail || file.type === "image" ? (
                          <img
                            src={file.thumbnail || file.url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                            <svg
                              className="w-4 h-4 text-gray-400"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 truncate">
                          {file.file.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {file.status === "ready"
                            ? "Ready"
                            : file.status === "processing"
                              ? `Processing ${file.progress}%`
                              : file.status === "uploading"
                                ? `Uploading ${file.progress}%`
                                : file.status === "error"
                                  ? "Error"
                                  : file.status}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {file.status === "ready" ? (
                          <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                        ) : file.status === "error" ? (
                          <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                        ) : (
                          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        )}
                      </div>
                    </div>
                  ))}

                  {uploadedFiles.length > 5 && (
                    <div className="text-xs text-gray-500 text-center">
                      and {uploadedFiles.length - 5} more files...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Video Split Results */}
            {processedVideos.length > 0 && (
              <div className="bg-white rounded-lg border p-4">
                <h3 className="font-medium text-gray-900 mb-3">Split Videos</h3>

                <div className="space-y-4">
                  {processedVideos.map((processed, index) => (
                    <div key={index} className="border rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-2">
                        <div className="w-6 h-6 rounded-sm overflow-hidden">
                          {processed.originalFile.thumbnail && (
                            <img
                              src={processed.originalFile.thumbnail}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-900 truncate">
                            {processed.originalFile.file.name}
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-gray-600 mb-2">
                        Split into {processed.segments.length} segments
                      </div>

                      <div className="grid grid-cols-3 gap-1">
                        {processed.segments.slice(0, 6).map((segment, segIndex) => (
                          <div
                            key={segment.id}
                            className="aspect-video bg-gray-100 rounded-sm text-xs flex items-center justify-center"
                          >
                            {segIndex + 1}
                          </div>
                        ))}
                        {processed.segments.length > 6 && (
                          <div className="aspect-video bg-gray-100 rounded-sm text-xs flex items-center justify-center">
                            +{processed.segments.length - 6}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-medium text-gray-900 mb-3">Quick Actions</h3>

              <div className="space-y-2">
                <button
                  onClick={handleCreateStories}
                  disabled={selectedFiles.length === 0}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Stories ({selectedFiles.length})
                </button>

                <button
                  disabled={uploadedFiles.filter((f) => f.type === "video").length === 0}
                  className="w-full px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Reels
                </button>

                <button
                  disabled={uploadedFiles.length === 0}
                  className="w-full px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Carousel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
