"use client";

/**
 * @file page.tsx
 * @description Post editor page for editing content, scheduling, and publishing an existing post
 *              with locale and tag support.
 * @component EditPostPage
 * @layer infrastructure
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { usePost, useProjects } from "@/lib/api/hooks";
import { useProviders } from "@/lib/hooks/useProviders";
import { runSagaAndAwaitTerminal } from "@/lib/api/clients/sagaClient";
import { apiClient } from "@/lib/api/client";
import { ClientContentEditor } from "@/components/editor/ClientContentEditor";
import { useProjectChannels } from "@/lib/hooks/useProjectChannels";
import { useSchedulePostViaSaga } from "@/lib/hooks/useSchedulePostViaSaga";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  ChannelMultiSelect,
  computeDefaultChannelSelection,
  Input,
  Label,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@packages/ui";
import { ArrowLeft, Save, Send, Calendar, BarChart3, Clock } from "lucide-react";
import { format } from "date-fns";

/**
 * @component EditPostPage
 * @description Post editor page for editing content, scheduling, and publishing an existing post with locale and tag support.
 */
export default function EditPostPage() {
  const router = useRouter();
  const t = useTranslations("posts");
  const params = useParams();
  const postId = params.id as string;

  const [locale, setLocale] = useState<"en" | "es">("en");
  const [tags, setTags] = useState<string>("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const { data: postData, isLoading: postLoading, error: postError, refetch } = usePost(postId);
  const { data: projectsData } = useProjects();
  const { providers: _providers } = useProviders();

  const post = postData?.data;
  const projects = projectsData?.data || [];

  const channelsQuery = useProjectChannels(post?.projectId);
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);
  const channelProviders = useMemo(
    () => Array.from(new Set(channels.map((c) => c.platform))),
    [channels]
  );
  const scheduleMutation = useSchedulePostViaSaga();
  const isScheduling = scheduleMutation.isPending;

  // Seed the channel selection with each provider's primary the first time the
  // schedule dialog opens (or whenever channels load while it's already open).
  useEffect(() => {
    if (!showScheduleDialog) return;
    if (channels.length === 0) return;
    setSelectedChannelIds((prev) => {
      if (prev.length > 0) return prev;
      return computeDefaultChannelSelection(channels, channelProviders);
    });
  }, [showScheduleDialog, channels, channelProviders]);

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
    if (selectedChannelIds.length === 0) {
      toast({
        title: t("toast.selectChannels"),
        description: t("toast.selectChannelsDesc"),
        variant: "destructive",
      });
      return;
    }
    if (!post?.projectId) {
      toast({
        title: t("toast.postNotLoaded"),
        description: t("toast.postNotLoadedDesc"),
        variant: "destructive",
      });
      return;
    }
    setIsPublishing(true);
    try {
      // Awaits the saga's terminal state — the button stays disabled while
      // the worker pipeline confirms each provider publish.
      await runSagaAndAwaitTerminal(
        {
          start: (input) => apiClient.startPostPublishingSaga(input),
          getStatus: (sagaId) => apiClient.getSagaStatus(sagaId),
        },
        {
          mode: "publish-now",
          projectId: post.projectId,
          postId,
          channelIds: selectedChannelIds,
        },
        // Publish-now goes through provider workers — allow a longer ceiling
        // than the default 60s.
        { pollIntervalMs: 1000, timeoutMs: 120_000 }
      );
      toast({ title: t("toast.postPublished") });
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.publishFailedDesc");
      toast({ title: t("toast.publishFailed"), description: message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [postId, post?.projectId, selectedChannelIds, refetch, t]);

  const handleSchedulePost = useCallback(async () => {
    if (!scheduleDate) {
      toast({
        title: t("toast.dateRequired"),
        description: t("toast.dateRequiredDesc"),
        variant: "destructive",
      });
      return;
    }

    if (selectedChannelIds.length === 0) {
      toast({
        title: t("toast.channelRequired"),
        description: t("toast.selectChannelsDesc"),
        variant: "destructive",
      });
      return;
    }

    try {
      await scheduleMutation.mutateAsync({
        postId,
        scheduledFor: new Date(scheduleDate).toISOString(),
        channelIds: selectedChannelIds,
      });
      toast({ title: t("toast.postScheduled") });
      setShowScheduleDialog(false);
      setScheduleDate("");
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.scheduleFailedDesc");
      toast({ title: t("toast.scheduleFailed"), description: message, variant: "destructive" });
    }
  }, [postId, scheduleDate, selectedChannelIds, scheduleMutation, refetch, t]);

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
      toast({ title: t("toast.changesSaved") });
      refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("toast.saveFailedDesc");
      toast({ title: t("toast.saveFailed"), description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [postId, post, locale, tags, refetch, t]);

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
              <p>{t("loadError")}</p>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard/posts")}
                className="mt-4"
              >
                {t("backToPosts")}
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
            <h1 className="text-3xl font-bold">{t("edit.title")}</h1>
            <p className="text-muted-foreground">
              {t("edit.lastUpdated", {
                date: format(new Date(post.updatedAt), "MMM d, yyyy 'at' h:mm a"),
              })}
            </p>
          </div>
        </div>
        <Badge className={getStatusColor(post.status)}>
          <StatusIcon className="mr-1 h-3 w-3" />
          {t(`status.${post.status}`)}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Post Info */}
          <Card>
            <CardHeader>
              <CardTitle>{t("info.title")}</CardTitle>
              <CardDescription>{t("info.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("fields.project")}</Label>
                  <div className="p-2 bg-muted rounded-sm">
                    {project?.name || t("info.unknownProject")}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="locale">{t("fields.language")}</Label>
                  <Select value={locale} onValueChange={(value: "en" | "es") => setLocale(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("language.en")}</SelectItem>
                      <SelectItem value="es">{t("language.es")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">{t("fields.tags")}</Label>
                <Input
                  id="tags"
                  placeholder={t("fields.tagsPlaceholder")}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("fields.tagsHint")}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("fields.created")}</Label>
                  <p>{format(new Date(post.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("fields.lastModified")}
                  </Label>
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
              <CardTitle>{t("actions.title")}</CardTitle>
              <CardDescription>{t("actions.manageDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {post.status === "DRAFT" && (
                <>
                  <Button className="w-full" onClick={handlePublishNow} disabled={isPublishing}>
                    <Send className="mr-2 h-4 w-4" />
                    {isPublishing ? t("actions.publishing") : t("actions.publishNow")}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowScheduleDialog((prev) => !prev)}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {t("actions.schedule")}
                  </Button>
                  {showScheduleDialog && (
                    <div className="space-y-3 p-3 border rounded-md bg-muted/50">
                      <Label htmlFor="schedule-date" className="text-sm">
                        {t("schedule.selectDateTime")}
                      </Label>
                      <Input
                        id="schedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="bg-background"
                      />
                      <ChannelMultiSelect
                        channels={channels}
                        selectedProviders={channelProviders}
                        value={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                      />
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleSchedulePost}
                        disabled={isScheduling || !scheduleDate || selectedChannelIds.length === 0}
                      >
                        {isScheduling ? t("actions.scheduling") : t("actions.confirmSchedule")}
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
                  {t("actions.viewAnalytics")}
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
                    {t("actions.modifySchedule")}
                  </Button>
                  {showScheduleDialog && (
                    <div className="space-y-3 p-3 border rounded-md bg-muted/50">
                      <Label htmlFor="reschedule-date" className="text-sm">
                        {t("schedule.newDateTime")}
                      </Label>
                      <Input
                        id="reschedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="bg-background"
                      />
                      <ChannelMultiSelect
                        channels={channels}
                        selectedProviders={channelProviders}
                        value={selectedChannelIds}
                        onChange={setSelectedChannelIds}
                      />
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={handleSchedulePost}
                        disabled={isScheduling || !scheduleDate || selectedChannelIds.length === 0}
                      >
                        {isScheduling ? t("actions.rescheduling") : t("actions.confirmNewSchedule")}
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
                {isSaving ? t("actions.saving") : t("actions.saveChanges")}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push(`/dashboard/posts/${postId}/preview`)}
              >
                {t("actions.previewPost")}
              </Button>
            </CardContent>
          </Card>

          {/* Performance Stats */}
          {post.status === "PUBLISHED" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("performance.title")}</CardTitle>
                <CardDescription>{t("performance.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("performance.totalReach")}</span>
                    <span className="font-medium text-muted-foreground">{t("common.loading")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("performance.engagementRate")}</span>
                    <span className="font-medium text-muted-foreground">{t("common.loading")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("performance.clicks")}</span>
                    <span className="font-medium text-muted-foreground">{t("common.loading")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("performance.shares")}</span>
                    <span className="font-medium text-muted-foreground">{t("common.loading")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revision History */}
          <Card>
            <CardHeader>
              <CardTitle>{t("revisions.title")}</CardTitle>
              <CardDescription>{t("revisions.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{t("revisions.currentVersion")}</p>
                    <p className="text-muted-foreground">{t("revisions.autoSaved")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t("revisions.now")}</span>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{t("revisions.manualSave")}</p>
                    <p className="text-muted-foreground">{t("revisions.updatedContent")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t("revisions.hoursAgo")}</span>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{t("revisions.created")}</p>
                    <p className="text-muted-foreground">{t("revisions.initialCreation")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t("revisions.dayAgo")}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
