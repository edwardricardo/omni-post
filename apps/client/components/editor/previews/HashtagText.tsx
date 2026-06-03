/**
 * @file HashtagText.tsx
 * @description Splits a string into spans, highlighting `#hashtag` runs with
 *              a configurable className. Applied uniformly to TikTok, Twitter,
 *              Bluesky, and Instagram previews so hashtags read consistently.
 * @component HashtagText
 * @layer infrastructure
 */

interface HashtagTextProps {
  text: string;
  /** Tailwind class applied to each `#tag` span. */
  hashtagClassName: string;
}

/**
 * Renders `text` with `#hashtag` runs wrapped in a span carrying
 * `hashtagClassName`. Plain text falls through unchanged.
 */
export function HashtagText({ text, hashtagClassName }: HashtagTextProps) {
  const parts = text.split(/(#\w+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^#\w+/.test(part) ? (
          <span key={index} className={hashtagClassName}>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}
