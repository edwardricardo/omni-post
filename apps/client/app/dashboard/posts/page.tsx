"use client";

/**
 * @file page.tsx
 * @description Posts list page with search, filter, sort, and bulk-action controls for the
 *              client dashboard.
 * @component PostsListPage
 * @layer infrastructure
 */
import React, { useState, Suspense, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDeletePost } from "@/lib/api/hooks";
import { Button } from "@packages/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Input } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@packages/ui";
import {
  PlusCircle,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Calendar,
  BarChart3,
  FileText,
  Zap,
} from "lucide-react";
import { cn } from "@packages/ui";
import { format } from "date-fns";
import {
  ConcurrentRenderer,
  PriorityList,
  useConcurrentData,
  useBackgroundTasks,
  usePerformanceMonitoring,
} from "@/lib/scalability/ConcurrentRenderer";
import { VirtualScrollList } from "@packages/ui";

const statusColors = {
  DRAFT: "bg-gray-100 text-gray-800",
  SCHEDULED: "bg-blue-100 text-blue-800",
  PUBLISHED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

const statusIcons = {
  DRAFT: FileText,
  SCHEDULED: Calendar,
  PUBLISHED: BarChart3,
  FAILED: Trash2,
};

/**
 * @component PostsPage
 * @description Lists all posts with search, filtering, status badges, and actions for editing, previewing, and deleting.
 */
export default function PostsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED"
  >("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list" | "virtual">("grid");
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");

  // Enhanced data fetching with concurrent features
  const fetchPosts = useCallback(async () => {
    const response = await fetch(
      `/api/posts?page=${currentPage}&limit=10&status=${statusFilter === "ALL" ? "" : statusFilter}`
    );
    if (!response.ok) throw new Error("Failed to fetch posts");
    return response.json();
  }, [currentPage, statusFilter]);

  const {
    data: postsData,
    isLoading,
    error,
    refresh: refreshPosts,
    isPending,
  } = useConcurrentData(fetchPosts, [currentPage, statusFilter], {
    refreshInterval: 30000, // Auto-refresh every 30 seconds
    priority,
    retryCount: 3,
  });

  const deletePost = useDeletePost();
  const { runBackgroundTask } = useBackgroundTasks();
  const { metrics, recordRender, recordConcurrentUpdate } = usePerformanceMonitoring();

  const totalPages = Math.ceil((postsData?.total || 0) / 10);

  // Optimized filtering with memoization
  const filteredPosts = useMemo(() => {
    const posts = postsData?.data || [];
    if (!searchTerm) return posts;
    const searchLower = searchTerm.toLowerCase();
    return posts.filter(
      (post: any) =>
        post.title?.toLowerCase().includes(searchLower) ||
        post.body?.toLowerCase().includes(searchLower)
    );
  }, [postsData?.data, searchTerm]);

  // Performance monitoring
  const handleRender = useCallback(() => {
    const startTime = performance.now();
    requestAnimationFrame(() => {
      recordRender(performance.now() - startTime);
    });
  }, [recordRender]);

  const handleDelete = useCallback(
    async (postId: string) => {
      if (confirm("Are you sure you want to delete this post?")) {
        // Run deletion in background for better UX
        runBackgroundTask(
          `delete-post-${postId}`,
          async () => {
            await deletePost.mutateAsync(postId);
            recordConcurrentUpdate();
            await refreshPosts();
            return { success: true };
          },
          { priority: "high" }
        );
      }
    },
    [deletePost, runBackgroundTask, recordConcurrentUpdate, refreshPosts]
  );

  const handlePriorityChange = useCallback(
    (newPriority: "high" | "normal" | "low") => {
      setPriority(newPriority);
      recordConcurrentUpdate();
    },
    [recordConcurrentUpdate]
  );

  const handleViewModeChange = useCallback(
    (mode: "grid" | "list" | "virtual") => {
      setViewMode(mode);
      recordConcurrentUpdate();
    },
    [recordConcurrentUpdate]
  );

  const _getPostPreview = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <p>Failed to load posts. Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            Posts
            {isPending && <Zap className="h-5 w-5 animate-pulse text-blue-500" />}
          </h1>
          <p className="text-muted-foreground">
            Manage your content across all platforms • {filteredPosts.length} posts
            {metrics.renderCount > 0 && (
              <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-sm">
                Render: {metrics.averageRenderTime.toFixed(1)}ms • Updates:{" "}
                {metrics.concurrentUpdates}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Performance Priority Control */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Zap className="mr-2 h-4 w-4" />
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handlePriorityChange("high")}>
                High Priority (Immediate)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePriorityChange("normal")}>
                Normal Priority
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePriorityChange("low")}>
                Low Priority (Deferred)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Mode Control */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                View: {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleViewModeChange("grid")}>
                Grid View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleViewModeChange("list")}>
                List View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleViewModeChange("virtual")}>
                Virtual Scroll
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={() => router.push("/dashboard/posts/new")}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Create Post
          </Button>
        </div>
      </div>

      {/* Enhanced Filters with Concurrent Features */}
      <ConcurrentRenderer priority={priority} enableTimeSlicing={true}>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search posts... (Real-time filtering)"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    recordConcurrentUpdate();
                  }}
                  className="pl-10"
                />
                {searchTerm && (
                  <Badge
                    variant="secondary"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    {filteredPosts.length} results
                  </Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Filter className="mr-2 h-4 w-4" />
                    Status: {statusFilter}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter("ALL");
                      recordConcurrentUpdate();
                    }}
                  >
                    All Posts
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter("DRAFT");
                      recordConcurrentUpdate();
                    }}
                  >
                    Draft
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter("SCHEDULED");
                      recordConcurrentUpdate();
                    }}
                  >
                    Scheduled
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter("PUBLISHED");
                      recordConcurrentUpdate();
                    }}
                  >
                    Published
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setStatusFilter("FAILED");
                      recordConcurrentUpdate();
                    }}
                  >
                    Failed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Refresh Button */}
              <Button
                variant="outline"
                onClick={() => {
                  refreshPosts();
                  recordConcurrentUpdate();
                }}
                disabled={isLoading || isPending}
              >
                {isPending ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                ) : (
                  "Refresh"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </ConcurrentRenderer>

      {/* Enhanced Posts List with Concurrent Rendering */}
      <Suspense
        fallback={
          <ConcurrentRenderer priority="high">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded-sm w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded-sm w-1/2"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded-sm"></div>
                      <div className="h-3 bg-gray-200 rounded-sm"></div>
                      <div className="h-3 bg-gray-200 rounded-sm w-2/3"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ConcurrentRenderer>
        }
      >
        {isLoading ? (
          <ConcurrentRenderer priority="high">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded-sm w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded-sm w-1/2"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded-sm"></div>
                      <div className="h-3 bg-gray-200 rounded-sm"></div>
                      <div className="h-3 bg-gray-200 rounded-sm w-2/3"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ConcurrentRenderer>
        ) : filteredPosts.length === 0 ? (
          <ConcurrentRenderer priority="normal">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No posts found</h3>
                  <p className="text-muted-foreground mb-4">
                    {searchTerm || statusFilter !== "ALL"
                      ? "No posts match your current filters."
                      : "Get started by creating your first post."}
                  </p>
                  <Button onClick={() => router.push("/dashboard/posts/new")}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Create Post
                  </Button>
                </div>
              </CardContent>
            </Card>
          </ConcurrentRenderer>
        ) : (
          <>
            <ConcurrentRenderer priority={priority} enableTimeSlicing={true}>
              {/* Dynamic View Mode Rendering */}
              {viewMode === "virtual" ? (
                <VirtualScrollList
                  items={filteredPosts}
                  itemHeight={120}
                  height={600}
                  renderItem={(post: any, _index, style) => {
                    const StatusIcon = statusIcons[post.status as keyof typeof statusIcons];
                    return (
                      <div style={style}>
                        <PostCard
                          key={post.id}
                          post={post}
                          StatusIcon={StatusIcon}
                          onDelete={handleDelete}
                          onRender={handleRender}
                          router={router}
                          isCompact={true}
                        />
                      </div>
                    );
                  }}
                  className="w-full"
                />
              ) : viewMode === "list" ? (
                <PriorityList
                  items={filteredPosts}
                  priority={priority}
                  batchSize={20}
                  renderItem={(post: any, _index) => {
                    const StatusIcon = statusIcons[post.status as keyof typeof statusIcons];
                    return (
                      <PostCard
                        post={post}
                        StatusIcon={StatusIcon}
                        onDelete={handleDelete}
                        onRender={handleRender}
                        router={router}
                        isCompact={false}
                        className="mb-4"
                      />
                    );
                  }}
                  keyExtractor={(post) => post.id}
                  className="space-y-4"
                />
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredPosts.map((post: any, _index: number) => {
                    const StatusIcon = statusIcons[post.status as keyof typeof statusIcons];
                    return (
                      <PostCard
                        key={post.id}
                        post={post}
                        StatusIcon={StatusIcon}
                        onDelete={handleDelete}
                        onRender={handleRender}
                        router={router}
                        isCompact={false}
                      />
                    );
                  })}
                </div>
              )}
            </ConcurrentRenderer>

            {/* Enhanced Pagination with Concurrent Loading */}
            {totalPages > 1 && viewMode !== "virtual" && (
              <ConcurrentRenderer priority="low" enableTimeSlicing={true}>
                <div className="flex justify-center space-x-2">
                  <Button
                    variant="outline"
                    disabled={currentPage === 1 || isPending}
                    onClick={() => {
                      setCurrentPage((prev) => Math.max(1, prev - 1));
                      recordConcurrentUpdate();
                    }}
                  >
                    {isPending ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                    ) : null}
                    Previous
                  </Button>
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                      const page = i + 1;
                      return (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            setCurrentPage(page);
                            recordConcurrentUpdate();
                          }}
                        >
                          {page}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    disabled={currentPage === totalPages || isPending}
                    onClick={() => {
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1));
                      recordConcurrentUpdate();
                    }}
                  >
                    Next
                    {isPending ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 ml-2"></div>
                    ) : null}
                  </Button>
                </div>
              </ConcurrentRenderer>
            )}
          </>
        )}
      </Suspense>
    </div>
  );
}

// Optimized PostCard component with concurrent features
function PostCard({
  post,
  StatusIcon,
  onDelete,
  onRender,
  router,
  isCompact = false,
  className = "",
}: {
  post: any;
  StatusIcon: any;
  onDelete: (id: string) => void;
  onRender: () => void;
  router: any;
  isCompact?: boolean;
  className?: string;
}) {
  const getPostPreview = useCallback((content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  }, []);

  // Track render performance
  React.useEffect(() => {
    onRender();
  }, [onRender]);

  if (isCompact) {
    return (
      <div
        className={`flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors ${className}`}
      >
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm truncate">{post.title || "Untitled Post"}</h4>
            <Badge
              className={cn("text-xs ml-2", statusColors[post.status as keyof typeof statusColors])}
            >
              <StatusIcon className="mr-1 h-3 w-3" />
              {post.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-1">
            {getPostPreview(post.body || "No content", 60)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {format(new Date(post.createdAt), "MMM d, yyyy")}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/dashboard/posts/${post.id}/preview`)}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/dashboard/posts/${post.id}`)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(post.id)} className="text-red-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <Card className={`hover:shadow-md transition-shadow ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg leading-6">{post.title || "Untitled Post"}</CardTitle>
            <CardDescription className="mt-1">
              {format(new Date(post.createdAt), "MMM d, yyyy")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={cn("text-xs", statusColors[post.status as keyof typeof statusColors])}
            >
              <StatusIcon className="mr-1 h-3 w-3" />
              {post.status}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => router.push(`/dashboard/posts/${post.id}/preview`)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/dashboard/posts/${post.id}`)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(post.id)} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {getPostPreview(post.body || "No content")}
        </p>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {post.tags.slice(0, 3).map((tag: string, index: number) => (
              <Badge key={index} variant="secondary" className="text-xs">
                #{tag}
              </Badge>
            ))}
            {post.tags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{post.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
