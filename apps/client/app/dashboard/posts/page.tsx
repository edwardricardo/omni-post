"use client";

/**
 * @file page.tsx
 * @description Posts list page. Owns search/filter/view-mode/page state
 *              and delegates rendering to dedicated sub-components under
 *              `components/`. Data comes from the canonical `usePosts`
 *              TanStack hook; deletion goes through `useDeletePost`.
 * @component PostsListPage
 * @layer infrastructure
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, toast } from "@packages/ui";
import { PlusCircle } from "lucide-react";
import type { Post } from "@/lib/api";
import { useDeletePost, usePosts } from "@/lib/api/hooks";
import {
  PostsEmptyState,
  PostsFilters,
  PostsLoadingSkeleton,
  PostsPagination,
  PostsViewSwitcher,
  type PostStatusFilter,
  type PostViewMode,
} from "./components";

/**
 * @component PostsPage
 * @description Lists all posts with search/filter, status badges, and
 *   actions for previewing, editing, and deleting.
 */
export default function PostsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<PostStatusFilter>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<PostViewMode>("grid");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const postsQueryParams = useMemo(
    () => ({
      page: currentPage,
      limit: 10,
      ...(statusFilter !== "ALL" && { status: statusFilter }),
    }),
    [currentPage, statusFilter]
  );

  const { data: postsData, isLoading, error, refetch: refetchPosts } = usePosts(postsQueryParams);

  const deletePost = useDeletePost();

  const totalPages = Math.ceil((postsData?.total ?? 0) / 10);

  const filteredPosts = useMemo(() => {
    const posts = postsData?.data ?? [];
    if (!searchTerm) return posts;
    const searchLower = searchTerm.toLowerCase();
    return posts.filter(
      (post: Post) =>
        post.title?.toLowerCase().includes(searchLower) ||
        post.body?.toLowerCase().includes(searchLower)
    );
  }, [postsData?.data, searchTerm]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deletePost.mutateAsync(deleteTarget);
      toast({ title: "Post deleted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete post.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }, [deletePost, deleteTarget]);

  const goToCreate = useCallback(() => router.push("/dashboard/posts/new"), [router]);
  const goToPreview = useCallback(
    (postId: string) => router.push(`/dashboard/posts/${postId}/preview`),
    [router]
  );
  const goToEdit = useCallback(
    (postId: string) => router.push(`/dashboard/posts/${postId}`),
    [router]
  );

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <PostsEmptyState hasFilters={false} onCreate={goToCreate} />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Posts</h1>
          <p className="text-muted-foreground">
            Manage your content across all platforms • {filteredPosts.length} posts
          </p>
        </div>
        <Button onClick={goToCreate}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Post
        </Button>
      </div>

      <PostsFilters
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        viewMode={viewMode}
        isLoading={isLoading}
        visibleCount={filteredPosts.length}
        onSearchChange={(term) => {
          setSearchTerm(term);
          setCurrentPage(1);
        }}
        onStatusChange={(status) => {
          setStatusFilter(status);
          setCurrentPage(1);
        }}
        onViewModeChange={setViewMode}
        onRefresh={() => refetchPosts()}
      />

      {isLoading ? (
        <PostsLoadingSkeleton />
      ) : filteredPosts.length === 0 ? (
        <PostsEmptyState
          hasFilters={Boolean(searchTerm) || statusFilter !== "ALL"}
          onCreate={goToCreate}
        />
      ) : (
        <>
          <PostsViewSwitcher
            posts={filteredPosts}
            viewMode={viewMode}
            onPreview={goToPreview}
            onEdit={goToEdit}
            onDelete={setDeleteTarget}
          />

          {totalPages > 1 && viewMode !== "virtual" && (
            <PostsPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete post?"
        description="Are you sure you want to delete this post? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        loading={deletePost.isPending}
      />
    </div>
  );
}
