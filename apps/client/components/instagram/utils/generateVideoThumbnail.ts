/**
 * @file generateVideoThumbnail.ts
 * @description Canvas-based video thumbnail generator. Loads a video,
 *              seeks to the requested timestamp, and renders the frame to
 *              a 9:16 (Instagram Stories) data URL. Called once per video
 *              file in the upload pipeline; segment-level thumbnails reuse
 *              the same primitive but pass a specific timestamp.
 * @layer infrastructure
 */

interface ThumbnailOptions {
  /** Canvas width — defaults to 270 (Stories aspect). */
  width?: number;
  /** Canvas height — defaults to 480 (Stories aspect). */
  height?: number;
  /**
   * Time within the video to capture in seconds. When omitted, captures
   * at `min(1, duration * 0.1)` to skip early black frames.
   */
  seekToSeconds?: number;
  /** JPEG quality (0–1). Default 0.8 — good quality, small payload. */
  quality?: number;
}

/**
 * Generate a thumbnail data URL for a video file. Returned URL is a
 * `data:image/jpeg` string — NOT a blob URL — so callers must NOT call
 * `URL.revokeObjectURL` on it (data URLs live in the string itself).
 */
export function generateVideoThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<string> {
  const { width = 270, height = 480, seekToSeconds, quality = 0.8 } = options;
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas context not available"));
      return;
    }

    const sourceUrl = URL.createObjectURL(file);
    canvas.width = width;
    canvas.height = height;

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = seekToSeconds ?? Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = canvas.width / canvas.height;

      let drawWidth: number;
      let drawHeight: number;
      let drawX: number;
      let drawY: number;
      if (videoAspect > canvasAspect) {
        drawHeight = canvas.height;
        drawWidth = drawHeight * videoAspect;
        drawX = (canvas.width - drawWidth) / 2;
        drawY = 0;
      } else {
        drawWidth = canvas.width;
        drawHeight = drawWidth / videoAspect;
        drawX = 0;
        drawY = (canvas.height - drawHeight) / 2;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);

      const thumbnailUrl = canvas.toDataURL("image/jpeg", quality);
      URL.revokeObjectURL(sourceUrl);
      resolve(thumbnailUrl);
    });

    video.onerror = (event) => {
      URL.revokeObjectURL(sourceUrl);
      reject(event instanceof Error ? event : new Error("Failed to load video for thumbnail"));
    };
    video.src = sourceUrl;
  });
}
