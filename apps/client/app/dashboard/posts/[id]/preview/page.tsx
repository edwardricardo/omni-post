"use client";

/**
 * @file page.tsx
 * @description Post preview page displaying a platform-specific preview with publish, schedule,
 *              and share actions.
 * @component PreviewPostPage
 * @layer infrastructure
 */
import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { usePost } from "@/lib/api/hooks";
import { apiClient } from "@/lib/api/client";
import { PlatformPreview } from "@/components/editor/PlatformPreview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  toast,
} from "@packages/ui";
import { ArrowLeft, Edit, Send, Calendar, Share2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth/authContext";
import { useProviders } from "@/lib/hooks/useProviders";

/**
 * @component PreviewPostPage
 * @description Displays a platform-specific preview of a post with publish, schedule, and share actions.
 */
export default function PreviewPostPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const { data: postData, isLoading: postLoading, error: postError, refetch } = usePost(postId);
  const { enabledProviders, getProviderConfig } = useProviders();

  const post = postData?.data;

  const { user } = useAuth();

  const [isPublishing, setIsPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);

  const handlePublishNow = useCallback(async () => {
    setIsPublishing(true);
    try {
      await apiClient.publishPost(postId);
      toast({ title: "Post published" });
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish post.";
      toast({ title: "Publish failed", description: message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [postId, refetch]);

  const handleSharePreview = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Failed to copy link to clipboard.",
        variant: "destructive",
      });
    }
  }, []);

  const handleSchedulePost = useCallback(async () => {
    if (!scheduleDate) {
      toast({
        title: "Date required",
        description: "Please select a date and time.",
        variant: "destructive",
      });
      return;
    }

    setIsScheduling(true);
    try {
      await apiClient.schedulePost(postId, new Date(scheduleDate).toISOString());
      toast({ title: "Post scheduled" });
      setShowScheduleDialog(false);
      setScheduleDate("");
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to schedule post.";
      toast({ title: "Schedule failed", description: message, variant: "destructive" });
    } finally {
      setIsScheduling(false);
    }
  }, [postId, scheduleDate, refetch]);

  // Use real user data for preview, with fallbacks
  const userInfo = {
    name: user?.name || "Your Name",
    username: user?.email?.split("@")[0] || "yourusername",
    // Avatar not available in current user model - omitting property
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "DRAFT":
        return "bg-gray-100 text-gray-800";
      case "SCHEDULED":
        return "bg-blue-100 text-blue-800";
      case "PUBLISHED":
        return "bg-green-100 text-green-800";
      case "FAILED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (postError) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <p>Failed to load post. Please try again later.</p>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard/posts")}
                className="mt-4"
              >
                Back to Posts
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (postLoading || !post) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded-sm w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded-sm w-1/2"></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="pt-6">
                <div className="h-96 bg-gray-200 rounded-sm"></div>
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded-sm w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-10 bg-gray-200 rounded-sm"></div>
                  <div className="h-10 bg-gray-200 rounded-sm"></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => router.back()} className="p-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Preview Post</h1>
            <p className="text-muted-foreground">
              See how your post will appear on different platforms
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={getStatusColor(post.status)}>{post.status}</Badge>
          <Button variant="outline" onClick={() => router.push(`/dashboard/posts/${postId}`)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main Preview Area */}
        <div className="lg:col-span-3">
          <PlatformPreview
            content={post.body || ""}
            mediaFiles={[]} // For now, we don't have media files in the preview
            selectedProviders={[]} // Show all available providers
            userInfo={userInfo}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Post Details */}
          <Card>
            <CardHeader>
              <CardTitle>Post Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Title</h4>
                <p className="mt-1">{post.title || "Untitled Post"}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Content Length</h4>
                <p className="mt-1">{post.body?.length || 0} characters</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Language</h4>
                <p className="mt-1">{post.locale === "en" ? "English" : "Spanish"}</p>
              </div>

              {post.tags && post.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Tags</h4>
                  <div className="flex flex-wrap gap-1">
                    {post.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Created</h4>
                <p className="mt-1 text-sm">
                  {format(new Date(post.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Last Updated</h4>
                <p className="mt-1 text-sm">
                  {format(new Date(post.updatedAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {post.status === "DRAFT" && (
                <>
                  <Button className="w-full" onClick={handlePublishNow} disabled={isPublishing}>
                    <Send className="mr-2 h-4 w-4" />
                    {isPublishing ? "Publishing..." : "Publish Now"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowScheduleDialog((prev) => !prev)}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    Schedule Post
                  </Button>
                  {showScheduleDialog && (
                    <div className="space-y-2 p-3 border rounded-md bg-muted/50">
                      <label htmlFor="preview-schedule-date" className="block text-sm font-medium">
                        Select date and time
                      </label>
                      <input
                        id="preview-schedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full p-2 border rounded-md bg-background text-foreground text-sm"
                      />
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleSchedulePost}
                        disabled={isScheduling || !scheduleDate}
                      >
                        {isScheduling ? "Scheduling..." : "Confirm Schedule"}
                      </Button>
                    </div>
                  )}
                </>
              )}

              <Button variant="outline" className="w-full" onClick={handleSharePreview}>
                <Share2 className="mr-2 h-4 w-4" />
                {copied ? "Link Copied!" : "Share Preview"}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push(`/dashboard/posts/${postId}`)}
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit Post
              </Button>
            </CardContent>
          </Card>

          {/* Platform Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Platform Analysis</CardTitle>
              <CardDescription>How this content performs on each platform</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {enabledProviders.map((provider) => {
                  const config = getProviderConfig(provider.name);
                  if (!config) return null;

                  const contentLength = post.body?.length || 0;
                  const isOptimal = contentLength <= config.charLimit * 0.8;
                  const willThread = contentLength > config.charLimit;

                  return (
                    <div key={provider.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-xs"
                            style={{ backgroundColor: config.color }}
                          />
                          <span className="text-sm font-medium">{config.displayName}</span>
                        </div>
                        <Badge
                          variant={isOptimal ? "default" : willThread ? "secondary" : "destructive"}
                          className="text-xs"
                        >
                          {isOptimal ? "Optimal" : willThread ? "Threading" : "Too Long"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {contentLength} / {config.charLimit} characters
                        {willThread && ` (${Math.ceil(contentLength / config.charLimit)} posts)`}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full ${
                            isOptimal ? "bg-green-500" : willThread ? "bg-blue-500" : "bg-red-500"
                          }`}
                          style={{
                            width: `${Math.min((contentLength / config.charLimit) * 100, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Performance Estimate */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Estimate</CardTitle>
              <CardDescription>Rule-based estimate from similar content</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Expected Reach</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Engagement Rate</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Estimated Clicks</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Best Time to Post</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
