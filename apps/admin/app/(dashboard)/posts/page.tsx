/**
 * @file page.tsx
 * @description Posts list page showing recent posts with status badges and links to detail views.
 * Fetches data via the usePosts hook with a configurable limit.
 */
"use client";

import Link from "next/link";
import { usePosts } from "@/hooks/api/usePosts";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

function PostsPageContent() {
  const { data: posts, isLoading, error, refetch } = usePosts(20);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Posts</h1>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" label="Loading posts..." />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Posts</h1>
          <div
            className="bg-red-50 border border-red-200 rounded-lg p-6"
            role="alert"
            aria-live="assertive"
          >
            <h2 className="text-red-800 font-medium mb-2">Error Loading Posts</h2>
            <p className="text-red-600 mb-4">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading posts"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Posts</h1>
            <p className="text-gray-600 mt-2">Manage your content posts</p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-600 text-white rounded-sm hover:bg-gray-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              aria-label="Refresh posts list"
            >
              Refresh
            </button>
            <Link
              href="/posts/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Create new post"
            >
              Create New Post
            </Link>
          </div>
        </div>

        {/* Stats Card */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6"
          role="region"
          aria-label="Post statistics"
        >
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Posts</div>
            <div className="text-2xl font-bold text-gray-900">{posts?.length || 0}</div>
          </div>
          <div className="bg-blue-50 rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-blue-600">Recent Posts (Last 20)</div>
            <div className="text-2xl font-bold text-blue-900">{posts?.length || 0}</div>
          </div>
          <div className="bg-green-50 rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-green-600">Latest Activity</div>
            <div className="text-sm font-medium text-green-900">
              {posts && posts.length > 0 && posts[0]
                ? new Date(posts[0].createdAt).toLocaleDateString()
                : "No posts yet"}
            </div>
          </div>
        </div>

        {/* Posts List */}
        <div
          className="bg-white rounded-lg shadow-sm overflow-hidden"
          role="region"
          aria-labelledby="posts-list"
        >
          <h2 id="posts-list" className="sr-only">
            Posts list
          </h2>
          {posts && posts.length > 0 ? (
            <nav aria-label="Posts navigation">
              <div className="divide-y divide-gray-200">
                {posts.map((post) => (
                  <Link
                    key={post.id}
                    href={`/posts/${post.id}`}
                    className="block hover:bg-gray-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-blue-500"
                    aria-label={`View post: ${post.title || "Untitled Post"} (${post.status})`}
                  >
                    <div className="px-6 py-4 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="text-sm font-mono text-gray-500">
                            {post.id.substring(0, 8)}...
                          </div>
                          <div className="text-sm text-gray-900">
                            {post.title || "Untitled Post"}
                          </div>
                          {post.status && (
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-full ${
                                post.status === "published"
                                  ? "bg-green-100 text-green-800"
                                  : post.status === "draft"
                                    ? "bg-gray-100 text-gray-800"
                                    : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {post.status}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {new Date(post.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </nav>
          ) : (
            <div className="text-center py-12 text-gray-500" role="status">
              <p className="text-lg mb-4">No posts found</p>
              <Link
                href="/posts/new"
                className="inline-block px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Create your first post"
              >
                Create Your First Post
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <PostsPageContent />;
}
