/**
 * @file contentHelpers.ts
 * @description Instagram content optimization and carousel planning helpers.
 *              Extracted from InstagramAdapter to respect the 800-line limit.
 * @layer infrastructure
 */

import type { CanonicalPost, ThreadPlan, Result, ThreadError } from "@shared/types";
import type { ProviderLimits } from "@ports/core";
import type { RenderedPost } from "@shared/types";
import { ok, err } from "@shared/types";

// ============================================================
// Content Type Detection
// ============================================================

export type InstagramContentType = "STORY" | "REEL" | "CAROUSEL" | "FEED";

/**
 * @function detectContentType
 * @description Detects Instagram content type based on rendered post media.
 */
export function detectContentType(post: RenderedPost): InstagramContentType {
  if (!post.media || post.media.length === 0) {
    return "FEED";
  }

  if (post.media.length > 1) {
    return "CAROUSEL";
  }

  return "FEED";
}

// ============================================================
// Content Optimization
// ============================================================

export function shouldCreateCarousel(canonical: CanonicalPost): boolean {
  if (canonical.media && canonical.media.length > 1) {
    return true;
  }

  if (canonical.body.length > 800) {
    return true;
  }

  const breakPoints = canonical.body.match(/\n\n|\. [A-Z]|[0-9]+\./g);
  if (breakPoints && breakPoints.length >= 2) {
    return true;
  }

  return false;
}

export function optimizeInstagramContent(content: string): string {
  let optimized = content
    .replace(/^[0-9]+\/[0-9]+\s*/, "")
    .replace(/🧵\s*/, "")
    .trim();

  optimized = optimized.replace(/\.$/, "");

  return optimized;
}

export function optimizeHashtags(content: string): string {
  const existingHashtags = content.match(/#\w+/g) || [];
  const maxHashtags = 10;

  const optimizedHashtags = existingHashtags
    .slice(0, maxHashtags)
    .map((tag) => tag.toLowerCase())
    .filter((tag, index, array) => array.indexOf(tag) === index);

  return optimizedHashtags.join(" ");
}

function splitContentForCarousel(content: string): string[] {
  const chunks: string[] = [];
  const maxChunkLength = 800;

  const paragraphs = content.split(/\n\n+/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length <= maxChunkLength) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      if (paragraph.length > maxChunkLength) {
        const sentences = paragraph.split(/\. /);
        let sentenceChunk = "";

        for (const sentence of sentences) {
          if ((sentenceChunk + sentence).length <= maxChunkLength) {
            sentenceChunk += (sentenceChunk ? ". " : "") + sentence;
          } else {
            if (sentenceChunk) {
              chunks.push(sentenceChunk.trim());
            }
            sentenceChunk = sentence;
          }
        }

        if (sentenceChunk) {
          currentChunk = sentenceChunk;
        } else {
          currentChunk = "";
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [content];
}

// ============================================================
// Carousel Planning
// ============================================================

export function planCarousel(
  canonical: CanonicalPost,
  limits: ProviderLimits
): Result<ThreadPlan, ThreadError> {
  const slides: ThreadPlan["tweets"] = [];

  if (canonical.media && canonical.media.length > 1) {
    canonical.media.forEach((media, index) => {
      const slideContent =
        index === 0 ? optimizeInstagramContent(canonical.body) : `Slide ${index + 1}`;

      slides.push({
        sequence: index + 1,
        text: slideContent,
        media: [media],
        estimatedChars: slideContent.length,
      });
    });
  } else {
    const contentChunks = splitContentForCarousel(canonical.body);

    contentChunks.forEach((chunk, index) => {
      const optimizedChunk = optimizeInstagramContent(chunk);

      slides.push({
        sequence: index + 1,
        text: optimizedChunk,
        estimatedChars: optimizedChunk.length,
        ...(index === 0 && canonical.media ? { media: canonical.media } : {}),
      });
    });
  }

  if (slides.length > 0) {
    const lastSlide = slides[slides.length - 1];
    const hashtags = optimizeHashtags(canonical.body);

    if (hashtags && lastSlide) {
      lastSlide.text = `${lastSlide.text}\n\n${hashtags}`.trim();
      lastSlide.estimatedChars = lastSlide.text.length;
    }
  }

  if (limits.maxPostsPerThread && slides.length > limits.maxPostsPerThread) {
    return err("CONTENT_TOO_LONG");
  }

  return ok({
    needsThreading: true,
    tweets: slides,
    totalChars: slides.reduce((sum, slide) => sum + slide.estimatedChars, 0),
    estimatedReach: 0,
    strategy: "AUTO",
  });
}
