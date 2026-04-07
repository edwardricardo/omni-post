"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { usePost, useProjects, useProviders } from "@/lib/api/hooks";
import { apiClient } from "@/lib/api/client";
import { ClientContentEditor } from "@/components/editor/ClientContentEditor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import { ArrowLeft, Save, Send, Calendar, BarChart3, Clock } from "lucide-react";
import { format } from "date-fns";

export default function EditPostPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const [locale, setLocale] = useState<"en" | "es">("en");
  const [tags, setTags] = useState<string>("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: postData, isLoading: postLoading, error: postError, refetch } = usePost(postId);
  const { data: projectsData } = useProjects();
  const { providers: _providers } = useProviders();

  const post = postData?.data;
  const projects = projectsData?.data || [];

  // Initialize form data when post loads
  useEffect(() => {
    if (post) {
      setLocale(post.locale as "en" | "es");
      setTags(post.tags?.join(", ") || "");
    }
  }, [post]);

  const handleContentChange = (_content: string, _charCount: number) => {
    // Content change handling is managed by the ContentEditor's auto-save
  };

  const handleMediaAdd = (_files: File[]) => {
    // Media handling is managed by the ContentEditor
  };

  const _parseTagsInput = (input: string): string[] => {
    return input
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  };

  const handlePublishNow = useCallback(async () => {
    setIsPublishing(true);
    try {
      await apiClient.publishPost(postId);
      alert("Post published successfully!");
      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to publish post.");
    } finally {
      setIsPublishing(false);
    }
  }, [postId, refetch]);

  // C9 & C11: Schedule or reschedule post
  const handleSchedulePost = useCallback(async () => {
    if (!scheduleDate) {
      alert("Please select a date and time.");
      return;
    }

    setIsScheduling(true);
    try {
      await apiClient.schedulePost(postId, new Date(scheduleDate).toISOString());
      alert("Post scheduled successfully!");
      setShowScheduleDialog(false);
      setScheduleDate("");
      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to schedule post.");
    } finally {
      setIsScheduling(false);
    }
  }, [postId, scheduleDate, refetch]);

  // C10: Save changes
  const handleSaveChanges = useCallback(async () => {
    if (!post) return;

    setIsSaving(true);
    try {
      const parsedTags = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      await apiClient.updatePost(postId, {
        locale,
        tags: parsedTags,
        ...(post.title && { title: post.title }),
        ...(post.body && { body: post.body }),
      });
      alert("Changes saved successfully!");
      refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  }, [postId, post, locale, tags, refetch]);

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "SCHEDULED":
        return Calendar;
      case "PUBLISHED":
        return BarChart3;
      case "FAILED":
        return Clock;
      default:
        return Save;
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
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded-sm w-1/4"></div>
                <div className="h-4 bg-gray-200 rounded-sm w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="h-10 bg-gray-200 rounded-sm"></div>
                  <div className="h-32 bg-gray-200 rounded-sm"></div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded-sm w-1/3"></div>
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

  const project = projects.find((p) => p.id === post.projectId);
  const StatusIcon = getStatusIcon(post.status);

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => router.back()} className="p-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Post</h1>
            <p className="text-muted-foreground">
              Last updated {format(new Date(post.updatedAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        </div>
        <Badge className={getStatusColor(post.status)}>
          <StatusIcon className="mr-1 h-3 w-3" />
          {post.status}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Post Info */}
          <Card>
            <CardHeader>
              <CardTitle>Post Information</CardTitle>
              <CardDescription>Basic information about this post</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Project</Label>
                  <div className="p-2 bg-muted rounded-sm">
                    {project?.name || "Unknown Project"}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="locale">Language</Label>
                  <Select value={locale} onValueChange={(value: "en" | "es") => setLocale(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  placeholder="tag1, tag2, tag3"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Separate tags with commas</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Created</Label>
                  <p>{format(new Date(post.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Last Modified</Label>
                  <p>{format(new Date(post.updatedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Content Editor */}
          <ClientContentEditor
            onContentChange={handleContentChange}
            onMediaAdd={handleMediaAdd}
            postId={postId}
            initialContent={post.body}
            {...(post.title && { initialTitle: post.title })}
            {...(post.tags && { initialTags: post.tags })}
            {...(post.projectId && { projectId: post.projectId })}
            {...(post.locale && { locale: post.locale })}
            showPreview={true}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Publishing Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>Manage this post</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                      <Label htmlFor="schedule-date" className="text-sm">
                        Select date and time
                      </Label>
                      <Input
                        id="schedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="bg-background"
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

              {post.status === "PUBLISHED" && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push("/dashboard/analytics")}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  View Analytics
                </Button>
              )}

              {post.status === "SCHEDULED" && (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowScheduleDialog((prev) => !prev)}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    Modify Schedule
                  </Button>
                  {showScheduleDialog && (
                    <div className="space-y-2 p-3 border rounded-md bg-muted/50">
                      <Label htmlFor="reschedule-date" className="text-sm">
                        New date and time
                      </Label>
                      <Input
                        id="reschedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="bg-background"
                      />
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleSchedulePost}
                        disabled={isScheduling || !scheduleDate}
                      >
                        {isScheduling ? "Rescheduling..." : "Confirm New Schedule"}
                      </Button>
                    </div>
                  )}
                </>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={handleSaveChanges}
                disabled={isSaving}
              >
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push(`/dashboard/posts/${postId}/preview`)}
              >
                Preview Post
              </Button>
            </CardContent>
          </Card>

          {/* Performance Stats */}
          {post.status === "PUBLISHED" && (
            <Card>
              <CardHeader>
                <CardTitle>Performance</CardTitle>
                <CardDescription>How this post is performing</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Total Reach</span>
                    <span className="font-medium text-muted-foreground">Loading...</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Engagement Rate</span>
                    <span className="font-medium text-muted-foreground">Loading...</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Clicks</span>
                    <span className="font-medium text-muted-foreground">Loading...</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Shares</span>
                    <span className="font-medium text-muted-foreground">Loading...</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revision History */}
          <Card>
            <CardHeader>
              <CardTitle>Revision History</CardTitle>
              <CardDescription>Track changes to this post</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Current version</p>
                    <p className="text-muted-foreground">Auto-saved changes</p>
                  </div>
                  <span className="text-xs text-muted-foreground">now</span>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Manual save</p>
                    <p className="text-muted-foreground">Updated content and tags</p>
                  </div>
                  <span className="text-xs text-muted-foreground">2h ago</span>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">Created</p>
                    <p className="text-muted-foreground">Initial post creation</p>
                  </div>
                  <span className="text-xs text-muted-foreground">1d ago</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
