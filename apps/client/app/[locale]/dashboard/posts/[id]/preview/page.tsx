"use client";

/**
 * @file page.tsx
 * @description Post preview page displaying a platform-specific preview with publish, schedule,
 *              and share actions.
 * @component PreviewPostPage
 * @layer infrastructure
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { usePost } from "@/lib/api/hooks";
import { apiClient } from "@/lib/api/client";
import { runSagaAndAwaitTerminal } from "@/lib/api/clients/sagaClient";
import { PlatformPreview } from "@/components/editor/PlatformPreview";
import { useProjectChannels } from "@/lib/hooks/useProjectChannels";
import { useSchedulePostViaSaga } from "@/lib/hooks/useSchedulePostViaSaga";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ChannelMultiSelect,
  computeDefaultChannelSelection,
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
  const t = useTranslations("posts");
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
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  const channelsQuery = useProjectChannels(post?.projectId);
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);
  const channelProviders = useMemo(
    () => Array.from(new Set(channels.map((c) => c.platform))),
    [channels]
  );
  const scheduleMutation = useSchedulePostViaSaga();
  const isScheduling = scheduleMutation.isPending;

  useEffect(() => {
    if (!showScheduleDialog) return;
    if (channels.length === 0) return;
    setSelectedChannelIds((prev) => {
      if (prev.length > 0) return prev;
      return computeDefaultChannelSelection(channels, channelProviders);
    });
  }, [showScheduleDialog, channels, channelProviders]);

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

  const handleSharePreview = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: t("toast.copyFailed"),
        description: t("toast.copyFailedDesc"),
        variant: "destructive",
      });
    }
  }, [t]);

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

  // Use real user data for preview, with fallbacks
  const userInfo = {
    name: user?.name || t("preview.defaultName"),
    username: user?.email?.split("@")[0] || t("preview.defaultUsername"),
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
            <h1 className="text-3xl font-bold">{t("preview.title")}</h1>
            <p className="text-muted-foreground">{t("preview.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={getStatusColor(post.status)}>{t(`status.${post.status}`)}</Badge>
          <Button variant="outline" onClick={() => router.push(`/dashboard/posts/${postId}`)}>
            <Edit className="mr-2 h-4 w-4" />
            {t("actions.edit")}
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
              <CardTitle>{t("details.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("details.postTitle")}
                </h4>
                <p className="mt-1">{post.title || t("card.untitled")}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("details.contentLength")}
                </h4>
                <p className="mt-1">{t("details.characters", { count: post.body?.length || 0 })}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("fields.language")}
                </h4>
                <p className="mt-1">{post.locale === "en" ? t("language.en") : t("language.es")}</p>
              </div>

              {post.tags && post.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {t("fields.tags")}
                  </h4>
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
                <h4 className="text-sm font-medium text-muted-foreground">{t("fields.created")}</h4>
                <p className="mt-1 text-sm">
                  {format(new Date(post.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground">
                  {t("details.lastUpdated")}
                </h4>
                <p className="mt-1 text-sm">
                  {format(new Date(post.updatedAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("actions.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                      <label htmlFor="preview-schedule-date" className="block text-sm font-medium">
                        {t("schedule.selectDateTime")}
                      </label>
                      <input
                        id="preview-schedule-date"
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full p-2 border rounded-md bg-background text-foreground text-sm"
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

              <Button variant="outline" className="w-full" onClick={handleSharePreview}>
                <Share2 className="mr-2 h-4 w-4" />
                {copied ? t("actions.linkCopied") : t("actions.sharePreview")}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push(`/dashboard/posts/${postId}`)}
              >
                <Edit className="mr-2 h-4 w-4" />
                {t("actions.editPost")}
              </Button>
            </CardContent>
          </Card>

          {/* Platform Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>{t("platformAnalysis.title")}</CardTitle>
              <CardDescription>{t("platformAnalysis.description")}</CardDescription>
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
                          {isOptimal
                            ? t("platformAnalysis.optimal")
                            : willThread
                              ? t("platformAnalysis.threading")
                              : t("platformAnalysis.tooLong")}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("platformAnalysis.charCount", {
                          count: contentLength,
                          limit: config.charLimit,
                        })}
                        {willThread &&
                          ` ${t("platformAnalysis.threadCount", {
                            count: Math.ceil(contentLength / config.charLimit),
                          })}`}
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
              <CardTitle>{t("performanceEstimate.title")}</CardTitle>
              <CardDescription>{t("performanceEstimate.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">{t("performanceEstimate.expectedReach")}</span>
                  <span className="font-medium text-muted-foreground">
                    {t("common.notAvailable")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">{t("performance.engagementRate")}</span>
                  <span className="font-medium text-muted-foreground">
                    {t("common.notAvailable")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">{t("performanceEstimate.estimatedClicks")}</span>
                  <span className="font-medium text-muted-foreground">
                    {t("common.notAvailable")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">{t("performanceEstimate.bestTime")}</span>
                  <span className="font-medium text-muted-foreground">
                    {t("common.notAvailable")}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
