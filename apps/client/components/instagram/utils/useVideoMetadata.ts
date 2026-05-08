/**
 * @file useVideoMetadata.ts
 * @description Async helper that loads metadata (width, height, duration,
 *              aspectRatio) from a video File via a hidden HTMLVideoElement.
 *              Pure async function (not a React hook) so it composes inside
 *              the upload pipeline without re-renders.
 * @layer infrastructure
 */

export interface VideoFileMetadata {
  width: number;
  height: number;
  duration: number;
  aspectRatio: number;
}

/**
 * Read intrinsic video metadata. Creates a temporary blob URL on the source
 * element and revokes it as soon as metadata loads (or errors).
 */
export function readVideoMetadata(file: File): Promise<VideoFileMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const metadata: VideoFileMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event instanceof Error ? event : new Error("Failed to load video metadata"));
    };
    video.src = url;
  });
}
