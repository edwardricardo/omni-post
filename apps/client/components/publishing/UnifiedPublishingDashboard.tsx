"use client";

/**
 * @file UnifiedPublishingDashboard.tsx
 * @description Unified publishing dashboard that orchestrates the content editor, provider
 * adaptation engine, preview system, scheduling, and queue management into a single workflow.
 * Fetches real data from the backend API for provider statuses, publishing queue, and schedules.
 */

import React, { useState, useCallback, useEffect } from "react";
import { AdminContentEditor } from "../editor/AdminContentEditor";
import { ProviderAdaptationEngine } from "../editor/ProviderAdaptationEngine";
import { ContentPreviewSystem } from "../editor/ContentPreviewSystem";
import type {
  PublishingSchedule,
  PublishingQueue,
  ProviderStatus,
  ProviderConstraints,
  ContentPayload,
  AdaptedContentMap,
} from "./publishingDashboardApi";
import {
  fetchProviderStatuses,
  fetchProviderConstraints,
  fetchPublishingQueue,
  fetchSchedules,
  publishContent,
  scheduleContent,
} from "./publishingDashboardApi";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface UnifiedPublishingDashboardProps {
  accountId: string;
  projectId: string;
  onPublishSuccess?: (queueItem: PublishingQueue) => void;
  onPublishError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function UnifiedPublishingDashboard({
  accountId,
  projectId,
  onPublishSuccess,
  onPublishError,
}: UnifiedPublishingDashboardProps) {
  // State management
  const [activeTab, setActiveTab] = useState<"compose" | "queue" | "schedule" | "providers">(
    "compose"
  );
  const [currentContent, setCurrentContent] = useState<ContentPayload | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerConstraints, setProviderConstraints] = useState<
    Record<string, ProviderConstraints>
  >({});
  const [publishingQueue, setPublishingQueue] = useState<PublishingQueue[]>([]);
  const [schedules, setSchedules] = useState<PublishingSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [adaptedContent, setAdaptedContent] = useState<AdaptedContentMap | null>(null);

  // -----------------------------------------------------------------------
  // Data loading from backend API
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetchProviderStatuses().then(setProviderStatuses);
    fetchProviderConstraints().then(setProviderConstraints);
    fetchPublishingQueue(projectId).then(setPublishingQueue);
    fetchSchedules(projectId).then(setSchedules);
  }, [projectId]);

  // Handle content publishing via API
  const handlePublishNow = useCallback(async () => {
    if (!currentContent || selectedProviders.length === 0) {
      onPublishError?.("Please create content and select at least one provider");
      return;
    }

    setIsLoading(true);
    try {
      const queueItem = await publishContent(projectId, currentContent, selectedProviders);
      setPublishingQueue((prev) => [queueItem, ...prev]);
      onPublishSuccess?.(queueItem);

      // Reset form
      setCurrentContent(null);
      setSelectedProviders([]);
      setActiveTab("queue");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to publish content";
      onPublishError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [currentContent, selectedProviders, projectId, onPublishSuccess, onPublishError]);

  const handleSchedulePost = useCallback(
    async (scheduledFor: Date) => {
      if (!currentContent || selectedProviders.length === 0) {
        onPublishError?.("Please create content and select at least one provider");
        return;
      }

      setIsLoading(true);
      try {
        const scheduleItem = await scheduleContent(
          projectId,
          currentContent,
          selectedProviders,
          scheduledFor
        );
        setSchedules((prev) => [...prev, scheduleItem]);

        // Reset form
        setCurrentContent(null);
        setSelectedProviders([]);
        setActiveTab("schedule");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to schedule content";
        onPublishError?.(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [currentContent, selectedProviders, projectId, onPublishError]
  );

  // Get status color for providers
  const getProviderStatusColor = (status: ProviderStatus) => {
    if (!status.connected) return "bg-gray-400";
    if (!status.healthy) return "bg-red-400";
    return "bg-green-400";
  };

  // Get status text for queue items
  const getQueueStatusText = (item: PublishingQueue) => {
    switch (item.status) {
      case "draft":
        return "Draft";
      case "queued":
        return "Queued";
      case "processing":
        return `Publishing... ${item.progress ?? 0}%`;
      case "published":
        return "Published";
      case "failed":
        return "Failed";
      default:
        return "Unknown";
    }
  };

  // Suppress unused-var warning for accountId (used by AdminContentEditor)
  void accountId;

  return (
    <div className="unified-publishing-dashboard max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Publishing Dashboard</h1>
        <p className="text-gray-600">Create, schedule, and manage your multi-platform content</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: "compose", name: "Compose" },
            { id: "queue", name: "Queue" },
            { id: "schedule", name: "Schedule" },
            { id: "providers", name: "Providers" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as "compose" | "queue" | "schedule" | "providers")}
              className={`
                flex items-center px-1 py-4 border-b-2 font-medium text-sm
                ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }
              `}
            >
              {tab.name}
              {tab.id === "queue" && publishingQueue.length > 0 && (
                <span className="ml-2 bg-blue-100 text-blue-600 py-1 px-2 rounded-full text-xs">
                  {publishingQueue.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "compose" && (
        <ComposeTab
          accountId={accountId}
          projectId={projectId}
          currentContent={currentContent}
          setCurrentContent={setCurrentContent}
          selectedProviders={selectedProviders}
          setSelectedProviders={setSelectedProviders}
          providerStatuses={providerStatuses}
          providerConstraints={providerConstraints}
          adaptedContent={adaptedContent}
          setAdaptedContent={setAdaptedContent}
          isLoading={isLoading}
          handlePublishNow={handlePublishNow}
          handleSchedulePost={handleSchedulePost}
          getProviderStatusColor={getProviderStatusColor}
        />
      )}

      {activeTab === "queue" && (
        <QueueTab
          publishingQueue={publishingQueue}
          getQueueStatusText={getQueueStatusText}
          onComposeClick={() => setActiveTab("compose")}
        />
      )}

      {activeTab === "schedule" && (
        <ScheduleTab schedules={schedules} onComposeClick={() => setActiveTab("compose")} />
      )}

      {activeTab === "providers" && (
        <ProvidersTab
          providerStatuses={providerStatuses}
          getProviderStatusColor={getProviderStatusColor}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose Tab
// ---------------------------------------------------------------------------
interface ComposeTabProps {
  accountId: string;
  projectId: string;
  currentContent: ContentPayload | null;
  setCurrentContent: (content: ContentPayload | null) => void;
  selectedProviders: string[];
  setSelectedProviders: React.Dispatch<React.SetStateAction<string[]>>;
  providerStatuses: ProviderStatus[];
  providerConstraints: Record<string, ProviderConstraints>;
  adaptedContent: AdaptedContentMap | null;
  setAdaptedContent: (content: AdaptedContentMap | null) => void;
  isLoading: boolean;
  handlePublishNow: () => void;
  handleSchedulePost: (date: Date) => void;
  getProviderStatusColor: (status: ProviderStatus) => string;
}

function ComposeTab({
  accountId,
  projectId,
  currentContent,
  setCurrentContent,
  selectedProviders,
  setSelectedProviders,
  providerStatuses,
  providerConstraints,
  adaptedContent,
  setAdaptedContent,
  isLoading,
  handlePublishNow,
  handleSchedulePost,
  getProviderStatusColor,
}: ComposeTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Content Editor */}
      <div className="space-y-6">
        <AdminContentEditor
          accountId={accountId}
          projectId={projectId}
          selectedProviders={selectedProviders}
          onContentChange={setCurrentContent}
          onValidationChange={() => {}}
          onPublish={async () => {
            handlePublishNow();
          }}
        />

        {/* Provider Selection */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="text-lg font-medium mb-4">Select Platforms</h3>
          {providerStatuses.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No providers available. Connect a provider in the Providers tab.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {providerStatuses.map((provider) => (
                <div
                  key={provider.providerId}
                  className={`
                    relative p-4 border rounded-lg cursor-pointer transition-all
                    ${
                      selectedProviders.includes(provider.providerId)
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }
                    ${!provider.connected ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                  onClick={() => {
                    if (!provider.connected) return;
                    setSelectedProviders((prev) =>
                      prev.includes(provider.providerId)
                        ? prev.filter((id) => id !== provider.providerId)
                        : [...prev, provider.providerId]
                    );
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{provider.providerId}</span>
                    <div className={`w-3 h-3 rounded-full ${getProviderStatusColor(provider)}`} />
                  </div>
                  {!provider.connected && (
                    <p className="text-sm text-gray-500 mt-1">Not connected</p>
                  )}
                  {provider.rateLimit && (
                    <p className="text-xs text-gray-400 mt-1">
                      {provider.rateLimit.remaining} requests remaining
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Publishing Actions */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="text-lg font-medium mb-4">Publishing Options</h3>
          <div className="flex space-x-4">
            <button
              onClick={handlePublishNow}
              disabled={!currentContent || selectedProviders.length === 0 || isLoading}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {isLoading ? "Publishing..." : "Publish Now"}
            </button>
            <button
              onClick={() => {
                const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);
                handleSchedulePost(scheduledFor);
              }}
              disabled={!currentContent || selectedProviders.length === 0 || isLoading}
              className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
            >
              Schedule for Later
            </button>
          </div>
        </div>
      </div>

      {/* Content Preview and Adaptation */}
      <div className="space-y-6">
        {currentContent && (
          <>
            <ProviderAdaptationEngine
              content={currentContent}
              providers={
                Object.fromEntries(
                  selectedProviders
                    .filter((id) => providerConstraints[id] !== undefined)
                    .map((id) => [id, providerConstraints[id]!])
                ) as Record<string, ProviderConstraints>
              }
              onAdaptationComplete={setAdaptedContent}
              enableAutoAdaptation={true}
            />

            {adaptedContent && (
              <ContentPreviewSystem
                originalContent={currentContent}
                adaptedContent={adaptedContent}
                selectedProviders={selectedProviders}
                onProviderSelect={() => {}}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue Tab
// ---------------------------------------------------------------------------
interface QueueTabProps {
  publishingQueue: PublishingQueue[];
  getQueueStatusText: (item: PublishingQueue) => string;
  onComposeClick: () => void;
}

function QueueTab({ publishingQueue, getQueueStatusText, onComposeClick }: QueueTabProps) {
  return (
    <div className="bg-white rounded-lg border">
      <div className="p-6 border-b">
        <h3 className="text-lg font-medium">Publishing Queue</h3>
        <p className="text-gray-600 text-sm">Track your content publication progress</p>
      </div>
      <div className="divide-y">
        {publishingQueue.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No items in queue</p>
            <button onClick={onComposeClick} className="mt-2 text-blue-600 hover:text-blue-800">
              Create your first post
            </button>
          </div>
        ) : (
          publishingQueue.map((item) => (
            <div key={item.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 mb-2">
                    {item.content.text.slice(0, 100)}
                    {item.content.text.length > 100 && "..."}
                  </p>
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <span>Platforms: {item.providers.join(", ")}</span>
                    <span>Created: {item.createdAt.toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`
                      inline-block px-2 py-1 rounded-full text-xs font-medium
                      ${item.status === "published" ? "bg-green-100 text-green-800" : ""}
                      ${item.status === "processing" ? "bg-blue-100 text-blue-800" : ""}
                      ${item.status === "queued" ? "bg-yellow-100 text-yellow-800" : ""}
                      ${item.status === "failed" ? "bg-red-100 text-red-800" : ""}
                      ${item.status === "draft" ? "bg-gray-100 text-gray-800" : ""}
                    `}
                  >
                    {getQueueStatusText(item)}
                  </span>
                  {item.status === "processing" && item.progress && (
                    <div className="mt-2 w-24 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule Tab
// ---------------------------------------------------------------------------
interface ScheduleTabProps {
  schedules: PublishingSchedule[];
  onComposeClick: () => void;
}

function ScheduleTab({ schedules, onComposeClick }: ScheduleTabProps) {
  return (
    <div className="bg-white rounded-lg border">
      <div className="p-6 border-b">
        <h3 className="text-lg font-medium">Scheduled Posts</h3>
        <p className="text-gray-600 text-sm">Manage your upcoming publications</p>
      </div>
      <div className="divide-y">
        {schedules.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No scheduled posts</p>
            <button onClick={onComposeClick} className="mt-2 text-blue-600 hover:text-blue-800">
              Schedule your first post
            </button>
          </div>
        ) : (
          schedules.map((schedule) => (
            <div key={schedule.id} className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {schedule.providers.join(", ")} publication
                  </p>
                  <p className="text-sm text-gray-500">
                    Scheduled for {schedule.scheduledFor.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <span
                    className={`
                      px-2 py-1 rounded-full text-xs font-medium
                      ${schedule.priority === "high" ? "bg-red-100 text-red-800" : ""}
                      ${schedule.priority === "medium" ? "bg-yellow-100 text-yellow-800" : ""}
                      ${schedule.priority === "low" ? "bg-gray-100 text-gray-800" : ""}
                    `}
                  >
                    {schedule.priority} priority
                  </span>
                  <span
                    className={`
                      px-2 py-1 rounded-full text-xs font-medium
                      ${schedule.status === "scheduled" ? "bg-blue-100 text-blue-800" : ""}
                      ${schedule.status === "pending" ? "bg-gray-100 text-gray-800" : ""}
                    `}
                  >
                    {schedule.status}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers Tab
// ---------------------------------------------------------------------------
interface ProvidersTabProps {
  providerStatuses: ProviderStatus[];
  getProviderStatusColor: (status: ProviderStatus) => string;
}

function ProvidersTab({ providerStatuses, getProviderStatusColor }: ProvidersTabProps) {
  if (providerStatuses.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        <p className="text-lg font-medium mb-2">No providers configured</p>
        <p className="text-sm">Connect your social media accounts to start publishing content.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {providerStatuses.map((provider) => (
        <div key={provider.providerId} className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium capitalize">{provider.providerId}</h3>
            <div className={`w-4 h-4 rounded-full ${getProviderStatusColor(provider)}`} />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Status:</span>
              <span className={provider.connected ? "text-green-600" : "text-red-600"}>
                {provider.connected ? "Connected" : "Disconnected"}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Health:</span>
              <span className={provider.healthy ? "text-green-600" : "text-yellow-600"}>
                {provider.healthy ? "Healthy" : "Issues detected"}
              </span>
            </div>

            {provider.lastUsed && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Last used:</span>
                <span>{provider.lastUsed.toLocaleDateString()}</span>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Errors:</span>
              <span className={provider.errorCount > 0 ? "text-red-600" : "text-green-600"}>
                {provider.errorCount}
              </span>
            </div>

            {provider.rateLimit && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Rate limit:</span>
                  <span>{provider.rateLimit.remaining} remaining</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, (provider.rateLimit.remaining / 300) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t">
            {provider.connected ? (
              <button className="w-full text-red-600 hover:bg-red-50 py-2 px-4 rounded-sm border border-red-200">
                Disconnect
              </button>
            ) : (
              <button className="w-full bg-blue-600 text-white hover:bg-blue-700 py-2 px-4 rounded-sm">
                Connect
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
