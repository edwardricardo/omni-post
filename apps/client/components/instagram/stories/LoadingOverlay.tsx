/**
 * @file LoadingOverlay.tsx
 * @component LoadingOverlay
 * @description Full-screen loading overlay displayed during media upload or video processing
 * operations in the Instagram Stories editor, with progress and status messages.
 */

import React from "react";

interface LoadingOverlayProps {
  isUploading: boolean;
  isProcessing: boolean;
}

export function LoadingOverlay({ isUploading, isProcessing }: LoadingOverlayProps) {
  if (!isUploading && !isProcessing) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-sm mx-auto">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="font-medium text-gray-900 mb-2">
            {isUploading ? "Uploading files..." : "Processing video..."}
          </div>
          <div className="text-sm text-gray-600">
            {isUploading
              ? "Please wait while we upload your media files"
              : "Splitting video into Stories-compatible segments"}
          </div>
        </div>
      </div>
    </div>
  );
}
