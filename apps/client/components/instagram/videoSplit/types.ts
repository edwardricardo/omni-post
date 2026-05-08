/**
 * @file types.ts
 * @description Shape of a preview segment as tracked by `useVideoSegments`.
 *              Extends the upstream `VideoSegment` (from the Instagram
 *              media processor) with UI-only state — `thumbnail` (data URL),
 *              `isGenerating` flag while canvas is rendering, and a
 *              progress hint.
 * @layer infrastructure
 */

import type { VideoSegment } from "@providers/instagram/src/mediaProcessor";

export interface PreviewSegment extends VideoSegment {
  thumbnail?: string;
  isGenerating?: boolean;
  progress?: number;
}
