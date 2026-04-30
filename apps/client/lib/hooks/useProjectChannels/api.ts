/**
 * @file api.ts
 * @description Internal fetch helpers for the project-scoped channels endpoints.
 *              Errors are normalised to `Error` instances with a stable message
 *              so callers (and the global TanStack `MutationCache.onError`) get
 *              useful information without having to parse status codes everywhere.
 * @layer infrastructure
 */

import type { ProjectChannel } from "./types";

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
