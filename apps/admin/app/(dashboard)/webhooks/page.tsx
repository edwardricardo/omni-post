/**
 * @file page.tsx
 * @description Webhook dashboard page with tabbed views for metrics, events, subscriptions,
 *   timeline, and dead-letter queue. Uses CSS design tokens and reusable UI components.
 * @layer infrastructure
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@packages/ui";
import { AlertCircle, Activity } from "lucide-react";

import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useWebhookMetrics } from "@/hooks/api/useWebhooks";
import { WebhookMetrics } from "@/components/webhooks/WebhookMetrics";
import { WebhookEventsList } from "@/components/webhooks/WebhookEventsList";
import { WebhookSubscriptions } from "@/components/webhooks/WebhookSubscriptions";
import { WebhookTimeline } from "@/components/webhooks/WebhookTimeline";
import { DeadLetterQueue } from "@/components/webhooks/DeadLetterQueue";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";

function WebhookDashboardContent() {
  const t = useTranslations("nav");
  const tw = useTranslations("webhooks");
  const tc = useTranslations("common");
  const [timeRange, setTimeRange] = useState("24h");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("overview");

  const {
    data: metrics,
    isLoading,
    error,
    refetch,
  } = useWebhookMetrics(timeRange, selectedProvider);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const getStatusColor = useCallback((successRate: number) => {
    if (successRate >= 95) return "text-[var(--success)]";
    if (successRate >= 90) return "text-[var(--warning)]";
    return "text-[var(--error)]";
  }, []);

  if (isLoading && !metrics) {
    return (
      <div>
        <PageHeader title={t("webhooks")} />
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" label={tc("loading")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("webhooks")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("webhooks")} />
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <AlertCircle className="h-12 w-12 text-[var(--error)] mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            {tw("errorTitle")}
          </h3>
          <p className="text-[var(--text-secondary)] mb-4">{getErrorMessage(error)}</p>
          <ActionButton variant="primary" size="sm" onClick={handleRefresh} loading={isLoading}>
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("webhooks")}
        description={tw("description")}
        actions={
          <div className="flex items-center gap-2">
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={tc("allProviders")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tc("allProviders")}</SelectItem>
                <SelectItem value="X">X (Twitter)</SelectItem>
                <SelectItem value="INSTAGRAM">Instagram</SelectItem>
                <SelectItem value="FACEBOOK">Facebook</SelectItem>
                <SelectItem value="YOUTUBE">YouTube</SelectItem>
                <SelectItem value="TIKTOK">TikTok</SelectItem>
              </SelectContent>
            </Select>

            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">{tw("timeRange.lastHour")}</SelectItem>
                <SelectItem value="6h">{tw("timeRange.last6Hours")}</SelectItem>
                <SelectItem value="24h">{tw("timeRange.last24Hours")}</SelectItem>
                <SelectItem value="7d">{tw("timeRange.last7Days")}</SelectItem>
                <SelectItem value="30d">{tw("timeRange.last30Days")}</SelectItem>
              </SelectContent>
            </Select>

            <ActionButton
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              loading={isLoading}
              aria-label="Refresh webhook data"
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              {tc("refresh")}
            </ActionButton>
          </div>
        }
      />

      {/* Key Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={tw("metrics.totalEvents")}
            value={Number(metrics.totalEvents).toLocaleString()}
          />
          <StatCard
            label={tw("metrics.successRate")}
            value={`${Number(metrics.successRate).toFixed(1)}%`}
          />
          <StatCard
            label={tw("metrics.avgProcessingTime")}
            value={`${Number(metrics.avgProcessingTime).toFixed(0)}ms`}
          />
          <StatCard
            label={tw("metrics.failedEvents")}
            value={Number(metrics.failedEvents).toLocaleString()}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">{tw("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="events">{tw("tabs.events")}</TabsTrigger>
          <TabsTrigger value="subscriptions">{tw("tabs.subscriptions")}</TabsTrigger>
          <TabsTrigger value="analytics">{tw("tabs.analytics")}</TabsTrigger>
          <TabsTrigger value="dead-letter">{tw("tabs.deadLetter")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {metrics && (
            <>
              <WebhookTimeline data={metrics.timeline} timeRange={timeRange} />
              <WebhookMetrics metrics={metrics} />
            </>
          )}
        </TabsContent>

        <TabsContent value="events">
          <WebhookEventsList
            {...(selectedProvider !== "all" && { provider: selectedProvider })}
            refreshTrigger={`${timeRange}-${selectedProvider}`}
          />
        </TabsContent>

        <TabsContent value="subscriptions">
          <WebhookSubscriptions />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {metrics && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{tw("providerPerformance.title")}</CardTitle>
                  <CardDescription>{tw("providerPerformance.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(metrics.byProvider).map(([provider, stats]) => (
                      <div
                        key={provider}
                        className="flex items-center justify-between p-4 border border-[var(--border-subtle)] rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="neutral">{provider}</Badge>
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">
                              {Number(stats.total).toLocaleString()} events
                            </p>
                            <p className="text-sm text-[var(--text-secondary)]">
                              {Number(stats.avgProcessingTime).toFixed(0)}ms avg
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-sm font-semibold ${getStatusColor(stats.successRate)}`}
                          >
                            {Number(stats.successRate).toFixed(1)}%
                          </div>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {stats.failed} failed
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{tw("eventTypes.title")}</CardTitle>
                  <CardDescription>{tw("eventTypes.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(metrics.byEventType)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([eventType, count]) => (
                        <div key={eventType} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            {eventType}
                          </span>
                          <Badge variant="neutral">{Number(count).toLocaleString()}</Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="dead-letter">
          <DeadLetterQueue />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * @component WebhookDashboard
 * @description Displays the webhook dashboard with metrics, events, subscriptions, timeline, and dead-letter queue tabs.
 */
export default function WebhookDashboard() {
  return <WebhookDashboardContent />;
}
