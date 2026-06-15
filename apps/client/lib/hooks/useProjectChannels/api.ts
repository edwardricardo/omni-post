/**
 * @file api.ts
 * @description Internal fetch helpers for the project-scoped channels endpoints.
 *              Errors are normalised to `Error` instances with a stable message
 *              so callers (and the global TanStack `MutationCache.onError`) get
 *              useful information without having to parse status codes everywhere.
 * @layer infrastructure
 */

import type { ProjectChannel } from "./types.js";

interface ChannelEnvelope {
  ok: boolean;
  data?: ProjectChannel | ProjectChannel[];
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    return body?.error?.message ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fetches all non-deleted channels belonging to a project.
 * Returns `[]` when the request fails so consumers can render an empty state
 * without throwing. Errors are surfaced via the TanStack Query result, not
 * the resolved value.
 */
export async function fetchProjectChannels(projectId: string): Promise<ProjectChannel[]> {
  const res = await fetch(`/api/backend/projects/${projectId}/channels`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to fetch channels (${res.status})`));
  }
  const body = (await res.json()) as ChannelEnvelope;
  const payload = body.data ?? body;
  if (Array.isArray(payload)) return payload as ProjectChannel[];
  return [];
}

/**
 * Connect a Bluesky account using App Password authentication. Backend
 * validates credentials, creates the Channel row, and returns the new
 * channelId + handle.
 */
export interface ConnectBlueskyInput {
  projectId: string;
  identifier: string;
  appPassword: string;
}
export interface ConnectBlueskyResult {
  channelId: string;
  handle: string;
  provider: "BLUESKY";
}
export async function connectBluesky(input: ConnectBlueskyInput): Promise<ConnectBlueskyResult> {
  const res = await fetch(`/api/backend/channels/bluesky/connect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to connect Bluesky (${res.status})`));
  }
  const body = (await res.json()) as { ok?: boolean; data?: ConnectBlueskyResult; error?: string };
  if (!body.ok || !body.data) {
    throw new Error(body.error ?? "Failed to connect Bluesky");
  }
  return body.data;
}

/**
 * Soft-deletes a channel (sets `deletedAt = now`). The row is retained for
 * audit but disappears from every active query.
 */
export async function disconnectChannel(channelId: string): Promise<{ deleted: true }> {
  const res = await fetch(`/api/backend/channels/${channelId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to disconnect channel (${res.status})`));
  }
  return { deleted: true };
}

/**
 * Promotes a channel to primary for its (project, provider) pair. The backend
 * unmarks the previous primary atomically inside the same transaction so the
 * partial unique index is never violated.
 */
export async function setPrimaryChannel(channelId: string): Promise<ProjectChannel> {
  const res = await fetch(`/api/backend/channels/${channelId}/set-primary`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Failed to set primary channel (${res.status})`));
  }
  const body = (await res.json()) as ChannelEnvelope;
  const payload = body.data ?? body;
  return payload as ProjectChannel;
}
