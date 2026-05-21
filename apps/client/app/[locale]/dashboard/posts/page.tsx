"use client";

/**
 * @file page.tsx
 * @description Posts list page. Owns search/filter/sort/view-mode/page state
 *              plus bulk-selection state. Search + tag filter + multi-status
 *              + sort are pushed to the backend via the canonical `usePosts`
 *              query params; bulk actions delegate to the dedicated
 *              `useArchivePostsBatch` / `useHardDeletePostsBatch` /
 *              `useDuplicatePostsBatch` mutations.
 * @component PostsListPage
 * @layer infrastructure
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button, ConfirmDialog, toast } from "@packages/ui";
import { PlusCircle } from "lucide-react";
import {
  useArchivePostsBatch,
  useDeletePost,
  useDuplicatePostsBatch,
  useHardDeletePostsBatch,
  usePosts,
} from "@/lib/api/hooks";
import type { PostSortField, PostStatus } from "@/lib/api/clients/postsClient";
import {
  PostsBulkActionsBar,
  PostsEmptyState,
  PostsFilters,
  PostsLoadingSkeleton,
  PostsPagination,
  PostsViewSwitcher,
  type PostViewMode,
} from "./components";

const PAGE_SIZE = 10;

type PendingBulkAction = "duplicate" | "archive" | "delete" | null;

function parseTagsCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * @component PostsPage
 * @description Lists posts with multi-status / tags filtering, sortable
 *   columns, three view modes, bulk selection, and bulk
 *   duplicate / archive / delete actions.
 */
export default function PostsPage() {
  const router = useRouter();

  // ── filter / sort / view state ─────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<PostStatus>>(new Set());
  const [tagsInput, setTagsInput] = useState("");
  const [sortBy, setSortBy] = useState<PostSortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<PostViewMode>("grid");
  const [currentPage, setCurrentPage] = useState(1);

  // ── single-row delete (existing UX) ────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // ── bulk-selection + pending bulk action ──────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction>(null);

  // Build query params — backend filters when set, else default list.
  const tags = useMemo(() => parseTagsCsv(tagsInput), [tagsInput]);
  const postsQueryParams = useMemo(
    () => ({
      page: currentPage,
      limit: PAGE_SIZE,
      ...(selectedStatuses.size > 0 && { status: Array.from(selectedStatuses) }),
      ...(tags.length > 0 && { tags }),
      ...(searchTerm.trim().length > 0 && { searchText: searchTerm.trim() }),
      sortBy,
      sortDirection,
    }),
    [currentPage, selectedStatuses, tags, searchTerm, sortBy, sortDirection]
  );

  const { data: postsData, isLoading, error, refetch: refetchPosts } = usePosts(postsQueryParams);

  const deletePost = useDeletePost();
  const archiveBatch = useArchivePostsBatch();
  const hardDeleteBatch = useHardDeletePostsBatch();
  const duplicateBatch = useDuplicatePostsBatch();

  const totalPages = Math.ceil((postsData?.total ?? 0) / PAGE_SIZE);
  const posts = postsData?.data ?? [];

  // ── mutation orchestration ────────────────────────────────────────────
  const isMutating =
    archiveBatch.isPending || hardDeleteBatch.isPending || duplicateBatch.isPending;

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

  const handleStatusToggle = useCallback((status: PostStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
    setCurrentPage(1);
  }, []);

  const handleSelectChange = useCallback((postId: string, next: boolean) => {
    setSelectedIds((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(postId);
      else updated.delete(postId);
      return updated;
    });
  }, []);

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const runBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    try {
      const result = await archiveBatch.mutateAsync(ids);
      toast({
        title: `Archived ${result.archived} ${result.archived === 1 ? "post" : "posts"}`,
      });
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to archive posts.";
      toast({ title: "Archive failed", description: message, variant: "destructive" });
    } finally {
      setPendingBulkAction(null);
    }
  }, [archiveBatch, selectedIds]);

  const runBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    try {
      const result = await hardDeleteBatch.mutateAsync(ids);
      toast({
        title: `Deleted ${result.deleted} ${result.deleted === 1 ? "post" : "posts"}`,
      });
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete posts.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    } finally {
      setPendingBulkAction(null);
    }
  }, [hardDeleteBatch, selectedIds]);

  const runBulkDuplicate = useCallback(async () => {
    const ids = Array.from(selectedIds);
    try {
      const result = await duplicateBatch.mutateAsync(ids);
      toast({
        title: `Duplicated ${result.duplicates.length} ${
          result.duplicates.length === 1 ? "post" : "posts"
        }`,
        ...(result.notFoundIds.length > 0 && {
          description: `${result.notFoundIds.length} source(s) not found and skipped.`,
        }),
      });
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to duplicate posts.";
      toast({ title: "Duplicate failed", description: message, variant: "destructive" });
    } finally {
      setPendingBulkAction(null);
    }
  }, [duplicateBatch, selectedIds]);

  // Confirm-dialog dispatch — deletion is destructive; duplicate + archive run inline.
  const handleBulkAction = useCallback(
    (action: PendingBulkAction) => {
      if (action === "duplicate") {
        void runBulkDuplicate();
        return;
      }
      if (action === "archive") {
        void runBulkArchive();
        return;
      }
      if (action === "delete") {
        setPendingBulkAction("delete");
      }
    },
    [runBulkArchive, runBulkDuplicate]
  );

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

  const hasFilters = Boolean(searchTerm.trim()) || selectedStatuses.size > 0 || tags.length > 0;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Posts</h1>
          <p className="text-muted-foreground">
            Manage your content across all platforms • {posts.length} posts
          </p>
        </div>
        <Button onClick={goToCreate}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Post
        </Button>
      </div>

      <PostsFilters
        searchTerm={searchTerm}
        selectedStatuses={selectedStatuses}
        tagsInput={tagsInput}
        sortBy={sortBy}
        sortDirection={sortDirection}
        viewMode={viewMode}
        isLoading={isLoading}
        visibleCount={posts.length}
        onSearchChange={(term) => {
          setSearchTerm(term);
          setCurrentPage(1);
        }}
        onStatusToggle={handleStatusToggle}
        onClearStatuses={() => {
          setSelectedStatuses(new Set());
          setCurrentPage(1);
        }}
        onTagsInputChange={(raw) => {
          setTagsInput(raw);
          setCurrentPage(1);
        }}
        onSortByChange={setSortBy}
        onSortDirectionChange={setSortDirection}
        onViewModeChange={setViewMode}
        onRefresh={() => refetchPosts()}
      />

      <PostsBulkActionsBar
        selectedCount={selectedIds.size}
        isPending={isMutating}
        onClear={handleClearSelection}
        onDuplicate={() => handleBulkAction("duplicate")}
        onArchive={() => handleBulkAction("archive")}
        onDelete={() => handleBulkAction("delete")}
      />

      {isLoading ? (
        <PostsLoadingSkeleton />
      ) : posts.length === 0 ? (
        <PostsEmptyState hasFilters={hasFilters} onCreate={goToCreate} />
      ) : (
        <>
          <PostsViewSwitcher
            posts={posts}
            viewMode={viewMode}
            onPreview={goToPreview}
            onEdit={goToEdit}
            onDelete={setDeleteTarget}
            selectedIds={selectedIds}
            onSelectChange={handleSelectChange}
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

      {/* Single-row soft-delete confirm */}
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

      {/* Bulk hard-delete confirm */}
      <ConfirmDialog
        open={pendingBulkAction === "delete"}
        onOpenChange={(open) => {
          if (!open) setPendingBulkAction(null);
        }}
        title={`Permanently delete ${selectedIds.size} ${
          selectedIds.size === 1 ? "post" : "posts"
        }?`}
        description="This will hard-delete the selected posts and all related data (contents, media, publish logs). This action cannot be undone."
        confirmLabel="Delete permanently"
        variant="danger"
        onConfirm={runBulkDelete}
        loading={hardDeleteBatch.isPending}
      />
    </div>
  );
}
