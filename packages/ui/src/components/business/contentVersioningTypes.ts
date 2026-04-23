/**
 * @file contentVersioningTypes.ts
 * @description Shared types (ContentVersion, ContentVersioningProps) and pure utility helpers
 *              consumed by ContentVersioning and its sub-views without circular dependencies.
 * @layer infrastructure
 */

import { format, formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Unified content-version record supporting both simple and complex use cases. */
export interface ContentVersion {
  id: string;
  version: number;
  title?: string;
  /** Simple content (client use case) or structured object with media. */
  content:
    | string
    | {
        text: string;
        media?: Array<{
          id: string;
          type: "image" | "video";
          url: string;
          alt?: string;
        }>;
      };
  summary?: string;
  author:
    | string
    | {
        id: string;
        name: string;
        avatar?: string;
      };
  createdAt: Date | string;
  tags: string[];
  isCurrent?: boolean;
  status?: "draft" | "scheduled" | "published" | "archived";
  parentVersion?: number;
  parent?: {
    versionId: string;
    version: number;
  };
  changeType:
    | "create"
    | "edit"
    | "branch"
    | "merge"
    | "created"
    | "edited"
    | "media_added"
    | "media_removed"
    | "scheduled"
    | "published"
    | "archived";
  comment?: string;
  changeDescription?: string;
  wordCount?: number;
  characterCount?: number;
  platforms?: string[];
  children?: Array<{
    versionId: string;
    version: number;
    changeType: string;
  }>;
  diff?: {
    additions: string[];
    deletions: string[];
    modifications: Array<{
      field: string;
      oldValue: string;
      newValue: string;
    }>;
  };
  performance?: {
    engagement: number;
    reach: number;
    clicks: number;
    shares: number;
  };
}

/** Props accepted by the top-level `ContentVersioning` component. */
export interface ContentVersioningProps {
  // Content identifier
  postId?: string;
  contentId?: string;

  // Current content state (for client mode)
  currentContent?: string;
  currentTitle?: string;
  currentTags?: string[];
  currentVersion?: number;

  // Event handlers
  onVersionSelect?: (version: ContentVersion) => void;
  onVersionRestore?: (version: ContentVersion | string) => void;
  onNewVersion?: (content: string, comment?: string) => void;
  onVersionCompare?: (version1: string, version2: string) => void;
  onVersionDownload?: (versionId: string, format: "json" | "txt" | "html") => void;

  // Feature flags
  showPerformanceData?: boolean;
  showCreateVersion?: boolean;
  showAdvancedFiltering?: boolean;
  showMediaSupport?: boolean;
  showCompareMode?: boolean;

  // Configuration
  maxVersionsToShow?: number;
  viewMode?: "timeline" | "tree" | "compact";

  // Optional versions data (if provided externally)
  versions?: ContentVersion[];

  // Toast/notification handler
  onNotification?: (notification: {
    title: string;
    description: string;
    type?: "success" | "error";
  }) => void;
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Normalize a version record so that `content` is always a plain string and
 * `createdAt` is always a `Date`.  The returned object shares identity with
 * the input for unmodified fields.
 */
export const normalizeVersion = (version: ContentVersion): ContentVersion => ({
  ...version,
  content: typeof version.content === "string" ? version.content : version.content.text,
  author: typeof version.author === "string" ? version.author : version.author.name,
  createdAt:
    typeof version.createdAt === "string" ? new Date(version.createdAt) : version.createdAt,
});

/** Extract the plain text content from a version regardless of content shape. */
export const getTextContent = (version: ContentVersion): string =>
  typeof version.content === "string" ? version.content : version.content.text;

/** Extract the author display name from a version regardless of author shape. */
export const getAuthorName = (version: ContentVersion): string =>
  typeof version.author === "string" ? version.author : version.author.name;

/** Extract the media array from a version, or `undefined` if not present. */
export const getVersionMedia = (version: ContentVersion) =>
  typeof version.content === "object" ? version.content.media : undefined;

/**
 * Format a date for display inside a version card.
 * Returns a locale string like "Jan 5, 2026, 10:30 AM".
 */
export const formatVersionDate = (date: Date | string): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** Human-readable relative time, e.g. "3 days ago". */
export const formatVersionRelativeDate = (date: Date | string): string =>
  formatDistanceToNow(new Date(date), { addSuffix: true });

/** Absolute date formatted with date-fns for the compare panel, e.g. "Jan 5, 2026". */
export const formatVersionAbsoluteDate = (date: Date | string): string =>
  format(new Date(date), "MMM d, yyyy");

/** Absolute date + time formatted with date-fns for the detail dialog. */
export const formatVersionFullDate = (date: Date | string): string =>
  format(new Date(date), "PPpp");

// ---------------------------------------------------------------------------
// Change-type display helpers (pure — no JSX)
// ---------------------------------------------------------------------------

/** Human-readable label for a change type. */
export const getChangeTypeLabel = (changeType: ContentVersion["changeType"]): string => {
  const labels: Record<ContentVersion["changeType"], string> = {
    create: "Created",
    created: "Created",
    edit: "Edited",
    edited: "Edited",
    branch: "Branched",
    merge: "Merged",
    media_added: "Media Added",
    media_removed: "Media Removed",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  };
  return labels[changeType] ?? changeType;
};

/** Tailwind CSS class string for the badge background/text of a change type. */
export const getChangeTypeColor = (changeType: ContentVersion["changeType"]): string => {
  const colors: Record<string, string> = {
    create: "bg-green-100 text-green-800",
    created: "bg-green-100 text-green-800",
    edit: "bg-blue-100 text-blue-800",
    edited: "bg-blue-100 text-blue-800",
    media_added: "bg-purple-100 text-purple-800",
    media_removed: "bg-red-100 text-red-800",
    scheduled: "bg-orange-100 text-orange-800",
    published: "bg-green-100 text-green-800",
    archived: "bg-gray-100 text-gray-800",
    branch: "bg-purple-100 text-purple-800",
    merge: "bg-orange-100 text-orange-800",
  };
  return colors[changeType] ?? "bg-gray-100 text-gray-800";
};

/**
 * Return the lucide icon *name* (string key) for a given change type so that
 * the rendering layer can import icons without duplicating this switch.
 * Values map to exported names from `lucide-react`.
 */
export const getChangeTypeIconKey = (changeType: ContentVersion["changeType"]): string => {
  switch (changeType) {
    case "create":
    case "created":
      return "Plus";
    case "edit":
    case "edited":
      return "Edit";
    case "branch":
      return "GitBranch";
    case "merge":
      return "ArrowRight";
    case "media_added":
      return "FileText";
    case "media_removed":
      return "Trash2";
    case "scheduled":
      return "Clock";
    case "published":
      return "Eye";
    case "archived":
      return "Trash2";
    default:
      return "FileText";
  }
};

// ---------------------------------------------------------------------------
// Word-level diff utility
// ---------------------------------------------------------------------------

export interface DiffToken {
  type: "added" | "removed" | "unchanged";
  text: string;
}

/**
 * Compute a simple word-level diff between two strings.
 * Returns an array of tokens each tagged as added, removed, or unchanged.
 */
export const computeWordDiff = (from: string, to: string): DiffToken[] => {
  const fromWords = from.split(" ");
  const toWords = to.split(" ");
  const diff: DiffToken[] = [];

  let i = 0;
  let j = 0;
  while (i < fromWords.length || j < toWords.length) {
    if (i >= fromWords.length) {
      diff.push({ type: "added", text: toWords[j] ?? "" });
      j++;
    } else if (j >= toWords.length) {
      diff.push({ type: "removed", text: fromWords[i] ?? "" });
      i++;
    } else if (fromWords[i] === toWords[j]) {
      diff.push({ type: "unchanged", text: fromWords[i] ?? "" });
      i++;
      j++;
    } else {
      diff.push({ type: "removed", text: fromWords[i] ?? "" });
      diff.push({ type: "added", text: toWords[j] ?? "" });
      i++;
      j++;
    }
  }
  return diff;
};
