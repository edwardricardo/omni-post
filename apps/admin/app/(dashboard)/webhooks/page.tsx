/**
 * @file page.tsx
 * @description Webhook dashboard page with tabbed views for metrics, event lists, subscriptions,
 * timeline, and dead-letter queue. Driven by the useWebhookMetrics hook with provider filtering.
 */
"use client";

import { useState } from "react";
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
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input as _Input,
} from "@packages/ui";
import { WebhookMetrics } from "@/components/webhooks/WebhookMetrics";
import { WebhookEventsList } from "@/components/webhooks/WebhookEventsList";
import { WebhookSubscriptions } from "@/components/webhooks/WebhookSubscriptions";
import { WebhookTimeline } from "@/components/webhooks/WebhookTimeline";
import { DeadLetterQueue } from "@/components/webhooks/DeadLetterQueue";
import { AlertCircle, Activity, Zap, Clock, TrendingUp } from "lucide-react";
import { useWebhookMetrics } from "@/hooks/api/useWebhooks";

interface _DashboardMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  successRate: number;
  avgProcessingTime: number;
  queueDepth: number;
  realtimeConnections: number;
  byProvider: Record<
    string,
    {
      total: number;
      success: number;
      failed: number;
      successRate: number;
      avgProcessingTime: number;
    }
  >;
  byEventType: Record<string, number>;
  timeline: Array<{
    timestamp: string;
    total: number;
    success: number;
    failed: number;
  }>;
}

function WebhookDashboardContent() {
  const [timeRange, setTimeRange] = useState("24h");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("overview");

  // Use TanStack Query hook with auto-refresh every 30 seconds
  const {
    data: metrics,
    isLoading,
    error,
    refetch,
  } = useWebhookMetrics(timeRange, selectedProvider);

  const getStatusColor = (successRate: number) => {
    if (successRate >= 95) return "text-green-600";
    if (successRate >= 90) return "text-yellow-600";
    return "text-red-600";
  };

  const getHealthBadge = (successRate: number) => {
    if (successRate >= 95)
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          Healthy
        </Badge>
      );
    if (successRate >= 90)
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
          Warning
        </Badge>
      );
    return <Badge variant="destructive">Critical</Badge>;
  };

  if (isLoading && !metrics) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Failed to load webhook dashboard
              </h3>
              <p className="text-gray-600 mb-4">
                {error instanceof Error ? error.message : String(error)}
              </p>
              <Button onClick={() => refetch()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Webhook Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor and manage your webhook integrations</p>
        </div>

        <div className="flex items-center space-x-4">
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
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
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="6h">Last 6 Hours</SelectItem>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isLoading}>
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Events</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.totalEvents.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">{timeRange} timeframe</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${getStatusColor(metrics.successRate)}`}>
                {metrics.successRate.toFixed(1)}%
              </div>
              <div className="flex items-center space-x-2 mt-1">
                {getHealthBadge(metrics.successRate)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Processing Time</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.avgProcessingTime.toFixed(0)}ms</div>
              <p className="text-xs text-muted-foreground">Per webhook event</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed Events</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {metrics.failedEvents.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">Requiring attention</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Dashboard Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="dead-letter">Dead Letter</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
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

        <TabsContent value="analytics" className="space-y-6">
          {metrics && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Provider Performance</CardTitle>
                  <CardDescription>
                    Webhook processing statistics by social media platform
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(metrics.byProvider).map(([provider, stats]) => (
                      <div
                        key={provider}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center space-x-3">
                          <Badge variant="outline">{provider}</Badge>
                          <div>
                            <p className="font-medium">{stats.total.toLocaleString()} events</p>
                            <p className="text-sm text-gray-600">
                              {stats.avgProcessingTime.toFixed(0)}ms avg
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-lg font-semibold ${getStatusColor(stats.successRate)}`}
                          >
                            {stats.successRate.toFixed(1)}%
                          </div>
                          <p className="text-sm text-gray-600">{stats.failed} failed</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Event Types</CardTitle>
                  <CardDescription>Distribution of webhook events by type</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(metrics.byEventType)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([eventType, count]) => (
                        <div key={eventType} className="flex items-center justify-between">
                          <span className="text-sm font-medium">{eventType}</span>
                          <Badge variant="secondary">{count.toLocaleString()}</Badge>
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

export default function WebhookDashboard() {
  return <WebhookDashboardContent />;
}
