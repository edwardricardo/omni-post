/**
 * @file useMediaUpload.ts
 * @description State hook for the Instagram media upload pipeline. Owns
 *              the file array, validation, async per-file processing
 *              (metadata + thumbnail), and the public mutators (`addFiles`,
 *              `removeFile`, `clearAll`). Validation errors surface via
 *              the injected `onError` callback so the host component can
 *              route them to a toast.
 * @hook useMediaUpload
 * @layer infrastructure
 */

import { useCallback, useState } from "react";
import { generateVideoThumbnail, readImageMetadata, readVideoMetadata } from "../utils";
import type { MediaFile, MediaFileStatus } from "./types";

interface UseMediaUploadOptions {
  acceptedTypes: string[];
  maxFileSize: number; // MB
  maxFiles: number;
  /**
   * Called whenever a candidate File fails validation. Host renders a
   * toast or other UI affordance — the hook itself never logs or throws.
   */
  onError?: (errors: string[]) => void;
  /** Called once a batch of validated files has been added (pre-processing). */
  onFilesAdded?: (files: MediaFile[]) => void;
  /** Called when a video > 15s should open the split preview modal. */
  onVideoNeedsSplit?: (file: MediaFile) => void;
}

interface UseMediaUploadResult {
  uploadedFiles: MediaFile[];
  isUploading: boolean;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeFile: (fileId: string) => void;
}

export function useMediaUpload({
  acceptedTypes,
  maxFileSize,
  maxFiles,
  onError,
  onFilesAdded,
  onVideoNeedsSplit,
}: UseMediaUploadOptions): UseMediaUploadResult {
  const [uploadedFiles, setUploadedFiles] = useState<MediaFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const validateFile = useCallback(
    (file: File, currentCount: number): { valid: true } | { valid: false; error: string } => {
      const isValidType = acceptedTypes.some((type) =>
        type.endsWith("/*") ? file.type.startsWith(type.slice(0, -1)) : file.type === type
      );
      if (!isValidType) {
        return {
          valid: false,
          error: `File type not supported. Accepted types: ${acceptedTypes.join(", ")}`,
        };
      }
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > maxFileSize) {
        return { valid: false, error: `File size too large. Maximum size: ${maxFileSize}MB` };
      }
      if (currentCount >= maxFiles) {
        return { valid: false, error: `Maximum ${maxFiles} files allowed` };
      }
      return { valid: true };
    },
    [acceptedTypes, maxFileSize, maxFiles]
  );

  const updateFile = useCallback((id: string, patch: Partial<MediaFile>) => {
    setUploadedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const updateStatus = useCallback(
    (id: string, status: MediaFileStatus, progress?: number, error?: string) => {
      updateFile(id, {
        status,
        ...(progress !== undefined && { progress }),
        ...(error !== undefined && { error }),
      });
    },
    [updateFile]
  );

  const processMediaFile = useCallback(
    async (mediaFile: MediaFile): Promise<MediaFile> => {
      updateStatus(mediaFile.id, "processing", 25);

      if (mediaFile.type === "video") {
        const metadata = await readVideoMetadata(mediaFile.file);
        updateFile(mediaFile.id, {
          metadata: {
            width: metadata.width,
            height: metadata.height,
            aspectRatio: metadata.aspectRatio,
          },
          duration: metadata.duration,
        });
        updateStatus(mediaFile.id, "processing", 50);

        const thumbnail = await generateVideoThumbnail(mediaFile.file);
        updateFile(mediaFile.id, { thumbnail });
        updateStatus(mediaFile.id, "processing", 75);

        const enriched: MediaFile = {
          ...mediaFile,
          metadata: {
            width: metadata.width,
            height: metadata.height,
            aspectRatio: metadata.aspectRatio,
          },
          duration: metadata.duration,
          thumbnail,
          status: "ready",
          progress: 100,
        };
        updateStatus(mediaFile.id, "ready", 100);

        // Videos longer than 15 seconds need to be split for Stories.
        if (metadata.duration > 15) {
          onVideoNeedsSplit?.(enriched);
        }
        return enriched;
      }

      if (mediaFile.type === "image") {
        const metadata = await readImageMetadata(mediaFile.file);
        updateFile(mediaFile.id, {
          metadata: {
            width: metadata.width,
            height: metadata.height,
            aspectRatio: metadata.aspectRatio,
          },
        });
      }
      updateStatus(mediaFile.id, "ready", 100);
      return { ...mediaFile, status: "ready", progress: 100 };
    },
    [onVideoNeedsSplit, updateFile, updateStatus]
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsUploading(true);
      const fileArray = Array.from(files);
      const validFiles: MediaFile[] = [];
      const errors: string[] = [];
      let count = uploadedFiles.length;

      for (const file of fileArray) {
        const validation = validateFile(file, count);
        if (!validation.valid) {
          errors.push(`${file.name}: ${validation.error}`);
          continue;
        }
        const mediaFile: MediaFile = {
          id: `file-${crypto.randomUUID()}`,
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
        count += 1;
      }

      if (errors.length > 0) {
        onError?.(errors);
      }

      if (validFiles.length === 0) {
        setIsUploading(false);
        return;
      }

      setUploadedFiles((prev) => [...prev, ...validFiles]);
      onFilesAdded?.(validFiles);

      for (const mediaFile of validFiles) {
        try {
          await processMediaFile(mediaFile);
        } catch (error: unknown) {
          updateStatus(
            mediaFile.id,
            "error",
            undefined,
            error instanceof Error ? error.message : "Processing failed"
          );
        }
      }
      setIsUploading(false);
    },
    [onError, onFilesAdded, processMediaFile, uploadedFiles.length, updateStatus, validateFile]
  );

  const removeFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => {
      const target = prev.find((f) => f.id === fileId);
      if (target) {
        // `url` is a blob URL — revoke. `thumbnail` is a data URL from
        // canvas.toDataURL, so it lives in the string itself; no revoke
        // needed and calling it would be a misleading no-op.
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((f) => f.id !== fileId);
    });
  }, []);

  return { uploadedFiles, isUploading, addFiles, removeFile };
}
