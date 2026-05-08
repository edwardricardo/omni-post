/**
 * @file planPublication.ts
 * @description Builds a publication plan by asking each channel's provider adapter to render a
 *              canonical post, collecting successes into Plan entries or aggregating errors.
 * @layer infrastructure
 */
import { ok, err, type Result, type CanonicalPost } from "@shared/types";
import type { ProviderAdapter, RenderedPost } from "@ports/core";

export type Plan = {
  providerId: string;
  channelId: string;
  dedupeKey: string;
  rendered: RenderedPost;
};

export function planPublication(
  post: CanonicalPost,
  channels: Array<{ channelId: string; provider: ProviderAdapter }>
): Result<Plan[], "RENDER_ERRORS"> {
  const plans: Plan[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];

  for (const ch of channels) {
    const rendered = ch.provider.render(post);
    if (rendered.ok) {
      // Only handle single posts for now, skip thread content
      if (rendered.value.type === "single") {
        const renderedPost = rendered.value.content as unknown as RenderedPost;
        plans.push({
          providerId: ch.provider.id,
          channelId: ch.channelId,
          dedupeKey: `${post.id}:${ch.channelId}`,
          rendered: renderedPost,
        });
      }
      // Future: handle thread content type via ThreadPlan processing pipeline
    } else {
      errors.push({ providerId: ch.provider.id, error: rendered.error });
    }
  }

  return errors.length ? err("RENDER_ERRORS") : ok(plans);
}
