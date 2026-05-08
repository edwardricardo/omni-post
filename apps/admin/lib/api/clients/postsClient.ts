/**
 * @file postsClient.ts
 * @description Legacy posts endpoints used by the admin app — list, read,
 *              create, publish, delete, plus log listings. New admin code
 *              should prefer the dedicated admin/account modules; these
 *              endpoints are kept for compatibility with the existing
 *              dashboard.
 * @layer infrastructure
 */

import { http } from "./http";

export interface ListPostsQuery {
  projectId?: string;
  limit?: number;
  offset?: number;
}

/**
 * @const postsClient
 * @description Methods for `/posts`, `/publish/:id`, and `/logs`.
 */
export const postsClient = {
  listPosts: (q: ListPostsQuery = {}) => {
    const p = new URLSearchParams();
    if (q.projectId) p.set("projectId", q.projectId);
    if (q.limit) p.set("limit", String(q.limit));
    if (q.offset) p.set("offset", String(q.offset));
    return http<{ ok: boolean; value: unknown[] }>(`/posts?${p.toString()}`);
  },

  createPost: (body: Record<string, unknown>) =>
    http<{ ok: boolean; value: unknown }>("/posts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getPost: (id: string) => http<{ ok: boolean; value: unknown }>(`/posts/${id}`),

  publish: (postId: string, body: { channelIds: string[]; scheduledAt?: string }) =>
    http<{ ok: boolean; value: unknown }>(`/publish/${postId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listLogs: (q: Record<string, unknown> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null) p.set(k, String(v));
    return http<{ ok: boolean; value: unknown[] }>(`/logs?${p.toString()}`);
  },

  deletePost: (id: string) => http<{ ok: boolean }>(`/posts/${id}`, { method: "DELETE" }),
};
