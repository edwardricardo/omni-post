"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/authContext";
import { usePosts, useProjects, useApiProviders } from "@/lib/api/hooks";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import {
  PlusCircle,
  BarChart3,
  Users,
  FileText,
  TrendingUp,
  Activity,
  Loader2,
} from "lucide-react";

/**
 * @component DashboardPage
 * @description Main dashboard overview showing key stats, recent posts, connected providers, and quick actions.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: postsData, isLoading: postsLoading } = usePosts({ limit: 5 });
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: providersData, isLoading: providersLoading } = useApiProviders();

  const isLoading = postsLoading || projectsLoading || providersLoading;

  const totalPosts = postsData?.total ?? 0;
  const connectedProviders = providersData?.providers?.filter((p) => p.isActive)?.length ?? 0;
  const recentPosts = postsData?.data ?? [];

  const stats = [
    {
      title: "Total Posts",
      value: isLoading ? "..." : String(totalPosts),
      icon: FileText,
    },
    {
      title: "Connected Accounts",
      value: isLoading ? "..." : String(connectedProviders),
      icon: Users,
    },
    {
      title: "Projects",
      value: isLoading ? "..." : String(projectsData?.total ?? 0),
      icon: TrendingUp,
    },
    {
      title: "Published",
      value: isLoading ? "..." : String(recentPosts.filter((p) => p.status === "PUBLISHED").length),
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Onboarding Checklist (hidden when complete or dismissed) */}
      <OnboardingChecklist />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome back, {user?.name?.split(" ")[0] || "User"}!
          </h1>
          <p className="text-muted-foreground">
            Here&apos;s an overview of your social media management
          </p>
        </div>
        <Button onClick={() => router.push("/dashboard/posts/new")}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Post
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions + Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks to manage your content</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => router.push("/dashboard/posts/new")}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Create New Post
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => router.push("/dashboard/analytics")}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                View Analytics
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => router.push("/dashboard/settings")}
              >
                <Users className="mr-2 h-4 w-4" />
                Manage Accounts
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your latest posts</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recentPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No posts yet. Create your first post to get started!
              </p>
            ) : (
              <div className="space-y-4">
                {recentPosts.slice(0, 5).map((post) => (
                  <div key={post.id} className="flex items-center space-x-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        post.status === "PUBLISHED"
                          ? "bg-green-500"
                          : post.status === "SCHEDULED"
                            ? "bg-blue-500"
                            : post.status === "FAILED"
                              ? "bg-red-500"
                              : "bg-yellow-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {post.title || "Untitled post"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {post.status} &middot; {new Date(post.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
