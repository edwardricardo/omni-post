/**
 * @file UploadedFileCard.tsx
 * @description Single tile in the uploaded-files grid. Shows preview
 *              (image/thumbnail/icon), upload/processing/error overlay,
 *              type + duration badges, and the remove button. Surfaces a
 *              "Split" CTA on ready videos longer than 15s.
 * @component UploadedFileCard
 * @layer infrastructure
 */

import { formatTime, formatFileSize } from "../utils";
import type { MediaFile } from "./types";

interface UploadedFileCardProps {
  file: MediaFile;
  /**
   * When true, the "Split" CTA is rendered on ready videos > 15s. Hosts
   * that don't wire video splitting (future use cases) can hide it.
   */
  showSplitButton: boolean;
  onRemove: (fileId: string) => void;
  onRequestSplit: (file: MediaFile) => void;
}

export function UploadedFileCard({
  file,
  showSplitButton,
  onRemove,
  onRequestSplit,
}: UploadedFileCardProps) {
  return (
    <div className="relative group border rounded-lg overflow-hidden bg-white shadow-xs">
      <div className="aspect-square bg-gray-100 relative">
        {file.type === "image" ? (
          <img src={file.url} alt={file.file.name} className="w-full h-full object-cover" />
        ) : file.type === "video" ? (
          file.thumbnail ? (
            <img src={file.thumbnail} alt={file.file.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V1a1 1 0 011-1h8a1 1 0 011 1v3M7 4h10m6 0v16a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1h20a1 1 0 011 1z"
              />
            </svg>
          </div>
        )}

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
                <svg className="w-8 h-8 mx-auto mb-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <div className="text-xs">Error</div>
              </div>
            ) : null}
          </div>
        )}

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

        {file.type === "video" && file.duration && (
          <div className="absolute top-2 right-2">
            <span className="px-2 py-1 text-xs font-medium bg-black/75 text-white rounded-sm">
              {formatTime(file.duration)}
            </span>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(file.id);
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ×
        </button>

        {showSplitButton &&
          file.type === "video" &&
          file.status === "ready" &&
          file.duration &&
          file.duration > 15 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRequestSplit(file);
              }}
              className="absolute bottom-2 right-2 px-2 py-1 bg-blue-600 text-white text-xs rounded-sm hover:bg-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Split
            </button>
          )}
      </div>

      <div className="p-2">
        <div className="text-xs font-medium text-gray-900 truncate">{file.file.name}</div>
        <div className="text-xs text-gray-500 mt-1">
          {formatFileSize(file.size)}
          {file.metadata && (
            <>
              {" "}
              • {file.metadata.width}×{file.metadata.height}
            </>
          )}
        </div>
        {file.error && <div className="text-xs text-red-600 mt-1 truncate">{file.error}</div>}
      </div>
    </div>
  );
}
