/**
 * @file DropZone.tsx
 * @description Presentational drop zone — drag&drop UI plus the hidden
 *              file input. Owns its own drag-state visual flag; file
 *              selection handling is forwarded to the host via `onFiles`.
 * @component DropZone
 * @layer infrastructure
 */

import React, { type DragEvent, useCallback, useRef, useState } from "react";

interface DropZoneProps {
  acceptedTypes: string[];
  maxFiles: number;
  maxFileSize: number;
  isUploading: boolean;
  /** Called with the dropped/selected files. Validation happens upstream. */
  onFiles: (files: FileList | File[]) => void;
}

export function DropZone({
  acceptedTypes,
  maxFiles,
  maxFileSize,
  isUploading,
  onFiles,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      if (e.dataTransfer.files.length > 0) {
        onFiles(e.dataTransfer.files);
      }
    },
    [onFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFiles(files);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [onFiles]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload media — click or drop files"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center transition-all
        ${isDragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
        ${isUploading ? "pointer-events-none opacity-75" : "cursor-pointer"}
      `}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
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
  );
}
