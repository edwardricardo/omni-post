import {
  ok,
  err,
  type Result,
  type CanonicalPost,
  type ThreadPlan,
  type TweetFragment,
  type ThreadStrategy,
  type ThreadError,
  type Media,
} from "@shared/types";

interface ThreadingConfig {
  maxCharsPerTweet: number;
  maxTweetsPerThread: number;
  maxMediaPerTweet: number;
  threadIndicatorLength: number; // Characters for "1/N "
}

const DEFAULT_CONFIG: ThreadingConfig = {
  maxCharsPerTweet: 280,
  maxTweetsPerThread: 25,
  maxMediaPerTweet: 4,
  threadIndicatorLength: 6, // "1/10 " = 5 chars, plus buffer
};

/**
 * Intelligently split content into thread-friendly chunks
 * Preserves sentence and paragraph boundaries when possible
 */
function smartSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find best break point within limit
    let breakPoint = maxChars;

    // Try to break at sentence boundaries
    const sentenceEnd = remaining.lastIndexOf(". ", maxChars);
    if (sentenceEnd > maxChars * 0.7) {
      // Don't break too early
      breakPoint = sentenceEnd + 1;
    } else {
      // Try paragraph breaks
      const paragraphEnd = remaining.lastIndexOf("\n\n", maxChars);
      if (paragraphEnd > maxChars * 0.6) {
        breakPoint = paragraphEnd + 2;
      } else {
        // Try word boundaries
        const wordEnd = remaining.lastIndexOf(" ", maxChars);
        if (wordEnd > maxChars * 0.8) {
          breakPoint = wordEnd;
        }
        // Otherwise use hard break at maxChars
      }
    }

    chunks.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }

  return chunks;
}

/**
 * Distribute media across thread tweets optimally
 */
function distributeMedia(media: Media[], tweetCount: number, maxMediaPerTweet: number): Media[][] {
  if (!media || media.length === 0) {
    const emptyArray: Media[][] = [];
    for (let i = 0; i < tweetCount; i++) {
      emptyArray.push([]);
    }
    return emptyArray;
  }

  const distribution: Media[][] = [];
  for (let i = 0; i < tweetCount; i++) {
    distribution.push([]);
  }

  // Put media in first tweet by default, unless it exceeds limit
  if (media.length <= maxMediaPerTweet) {
    distribution[0] = media;
  } else {
    // Distribute evenly across tweets
    media.forEach((item, index) => {
      const tweetIndex = index % tweetCount;
      const tweetMedia = distribution[tweetIndex];
      if (tweetMedia && tweetMedia.length < maxMediaPerTweet) {
        tweetMedia.push(item);
      }
    });
  }

  return distribution;
}

/**
 * Plan an intelligent thread for the given content
 */
export function planThread(
  post: CanonicalPost,
  strategy: ThreadStrategy = "AUTO",
  config: Partial<ThreadingConfig> = {}
): Result<ThreadPlan, ThreadError> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const content = post.body.trim();

  // Check if threading is needed
  const needsThreading =
    content.length > fullConfig.maxCharsPerTweet - fullConfig.threadIndicatorLength;

  if (strategy === "SINGLE" || !needsThreading) {
    // Force single tweet or content fits in one tweet
    const truncated =
      content.length > fullConfig.maxCharsPerTweet
        ? content.substring(0, fullConfig.maxCharsPerTweet - 1) + "…"
        : content;

    return ok({
      strategy: "SINGLE",
      tweets: [
        {
          sequence: 1,
          text: truncated,
          media: post.media || [],
          estimatedChars: truncated.length,
        },
      ],
      totalChars: content.length,
      estimatedReach: 1,
      needsThreading: false,
    });
  }

  // Calculate space available for content (accounting for thread indicators)
  const contentSpacePerTweet = fullConfig.maxCharsPerTweet - fullConfig.threadIndicatorLength;

  // Split content intelligently
  const textChunks = smartSplit(content, contentSpacePerTweet);

  if (textChunks.length > fullConfig.maxTweetsPerThread) {
    return err("CONTENT_TOO_LONG");
  }

  // Distribute media across tweets
  const mediaDistribution = distributeMedia(
    post.media || [],
    textChunks.length,
    fullConfig.maxMediaPerTweet
  );

  // Create tweet fragments
  const tweets: TweetFragment[] = textChunks.map((text, index) => {
    const sequence = index + 1;
    const threadIndicator = `${sequence}/${textChunks.length} `;
    const finalText = threadIndicator + text;
    const media = mediaDistribution[index];

    return {
      sequence,
      text: finalText,
      ...(media ? { media } : {}),
      estimatedChars: finalText.length,
      threadIndicator,
    };
  });

  // Validate all tweets fit within limits
  for (const tweet of tweets) {
    if (tweet.estimatedChars > fullConfig.maxCharsPerTweet) {
      return err("THREAD_PLANNING_FAILED");
    }
  }

  return ok({
    strategy: strategy === "MANUAL" ? "MANUAL" : "AUTO",
    tweets,
    totalChars: content.length,
    estimatedReach: tweets.length,
    needsThreading: true,
  });
}

/**
 * Estimate the reach/engagement multiplier for a thread
 * Threads typically get higher engagement than single tweets
 */
export function estimateThreadReach(tweetCount: number): number {
  if (tweetCount === 1) return 1.0;
  if (tweetCount <= 3) return 1.2;
  if (tweetCount <= 5) return 1.4;
  if (tweetCount <= 10) return 1.3; // Diminishing returns
  return 1.1; // Very long threads may lose audience
}

/**
 * Validate a thread plan meets platform constraints
 */
export function validateThreadPlan(
  plan: ThreadPlan,
  config: Partial<ThreadingConfig> = {}
): Result<void, ThreadError> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  if (plan.tweets.length > fullConfig.maxTweetsPerThread) {
    return err("CONTENT_TOO_LONG");
  }

  for (const tweet of plan.tweets) {
    if (tweet.estimatedChars > fullConfig.maxCharsPerTweet) {
      return err("THREAD_PLANNING_FAILED");
    }

    if (tweet.media && tweet.media.length > fullConfig.maxMediaPerTweet) {
      return err("MEDIA_DISTRIBUTION_FAILED");
    }
  }

  return ok(undefined);
}
