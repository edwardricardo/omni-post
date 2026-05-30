/**
 * @file format.ts
 * @description Shared formatting helpers for Instagram media UI: time
 *              (mm:ss), file size (KB / MB), duration (mm:ss padded).
 * @layer infrastructure
 */

/** Format a duration in seconds as `m:ss` (minutes + zero-padded seconds). */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format a byte count for display: under 1 MB shows KB with no decimals,
 * 1 MB and above shows MB with one decimal.
 */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${(bytes / 1024).toFixed(0)}KB` : `${mb.toFixed(1)}MB`;
}
