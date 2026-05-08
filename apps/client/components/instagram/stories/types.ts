/**
 * @file types.ts
 * @description TypeScript type definitions for Instagram Stories, including StoryMedia,
 * StoryContent, StoriesProject, and re-exports of video processing types.
 */

import { VideoSegment, VideoSplitOptions } from "@providers/instagram/src/mediaProcessor";

export interface StoryMedia {
  id: string;
  type: "image" | "video";
  url: string;
  file?: File;
  alt?: string;
  duration?: number;
  preview?: string;
  segments?: VideoSegment[];
}

export interface StoryContent {
  id: string;
  media: StoryMedia;
  text?: string;
  duration: number;
  background?: {
    color?: string;
    gradient?: string;
  };
  stickers?: Array<{
    id: string;
    type: "text" | "emoji" | "location" | "hashtag" | "mention";
    content: string;
    position: { x: number; y: number };
    style?: Record<string, string | number>;
  }>;
}

export interface StoriesProject {
  id: string;
  name: string;
  stories: StoryContent[];
  scheduledAt?: Date;
  status: "draft" | "ready" | "scheduled" | "published";
  targetAccounts: string[];
}

export interface StoriesEditorProps {
  projectId: string;
  accountId: string;
  onSave?: (project: StoriesProject) => void;
  onSchedule?: (project: StoriesProject, scheduledAt: Date) => void;
  onPublish?: (project: StoriesProject) => void;
  onError?: (error: string) => void;
}

export type { VideoSegment, VideoSplitOptions };
