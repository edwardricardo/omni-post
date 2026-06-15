/**
 * @file PostsViewSwitcher.tsx
 * @description Renders the posts list in one of three layouts: virtual
 *              (windowed scroll for large lists), list (compact tiles
 *              stacked vertically), or grid (3-column cards). Pure
 *              presentational — view mode + actions are forwarded.
 * @component PostsViewSwitcher
 * @layer infrastructure
 */

import { VirtualScrollList } from "@packages/ui";
import type { Post } from "@/lib/api";
import { PostCard } from "./PostCard.js";
import type { PostViewMode } from "./PostsFilters.js";

interface PostsViewSwitcherProps {
  posts: Post[];
  viewMode: PostViewMode;
  onPreview: (postId: string) => void;
  onEdit: (postId: string) => void;
  onDelete: (postId: string) => void;
  /** When provided, every card renders a selection checkbox. */
  selectedIds?: ReadonlySet<string>;
  onSelectChange?: (postId: string, next: boolean) => void;
}

export function PostsViewSwitcher({
  posts,
  viewMode,
  onPreview,
  onEdit,
  onDelete,
  selectedIds,
  onSelectChange,
}: PostsViewSwitcherProps) {
  const cardSelectionProps = (postId: string) =>
    selectedIds && onSelectChange ? { isSelected: selectedIds.has(postId), onSelectChange } : {};

  if (viewMode === "virtual") {
    return (
      <VirtualScrollList
        items={posts}
        itemHeight={120}
        height={600}
        renderItem={(post: Post, _index, style) => (
          <div style={style}>
            <PostCard
              key={post.id}
              post={post}
              onPreview={onPreview}
              onEdit={onEdit}
              onDelete={onDelete}
              isCompact
              {...cardSelectionProps(post.id)}
            />
          </div>
        )}
        className="w-full"
      />
    );
  }

  if (viewMode === "list") {
    return (
      <div className="space-y-4">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onPreview={onPreview}
            onEdit={onEdit}
            onDelete={onDelete}
            className="mb-4"
            {...cardSelectionProps(post.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onPreview={onPreview}
          onEdit={onEdit}
          onDelete={onDelete}
          {...cardSelectionProps(post.id)}
        />
      ))}
    </div>
  );
}
