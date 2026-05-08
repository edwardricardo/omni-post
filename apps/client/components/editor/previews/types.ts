/**
 * @file types.ts
 * @description Shared types for the per-platform preview components — the
 *              media descriptor, the user info bag, the props shape every
 *              preview accepts, and the threaded variant for X/Bluesky.
 * @layer infrastructure
 */

/**
 * A single piece of media as consumed by previews. `url` is a blob URL
 * produced by `useObjectURLs`; `isImage` is derived once from `file.type`
 * so child components don't have to inspect the original File.
 */
export interface PreviewMedia {
  url: string;
  isImage: boolean;
}

/**
 * Author/account information rendered inside each preview's header.
 */
export interface PreviewUserInfo {
  name: string;
  username: string;
  avatar?: string;
}

/**
 * Common props every per-platform preview receives.
 */
export interface PreviewProps {
  content: string;
  media: PreviewMedia[];
  userInfo: PreviewUserInfo;
}

/**
 * One slice of content split across a thread. X and Bluesky paginate posts
 * over their character cap; the dispatcher computes segments via
 * `providerRegistry.getThreadSegments` and hands them to the preview.
 */
export interface ThreadSegment {
  text: string;
  index: number;
  charCount: number;
}

/**
 * Props shape for previews that render threaded content (X, Bluesky).
 */
export interface ThreadedPreviewProps extends PreviewProps {
  threadSegments: ThreadSegment[];
}
