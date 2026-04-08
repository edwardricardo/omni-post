"use client";

/**
 * @file WebhookSubscriptions.tsx
 * @description Webhook subscription management component for creating, editing, toggling,
 * and deleting webhook endpoints with provider, event type, and URL configuration.
 */

import { useState, useEffect } from "react";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@packages/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  Plus,
  Settings,
  Trash2,
  Copy,
  CheckCircle as _CheckCircle,
  AlertCircle as _AlertCircle,
  ExternalLink as _ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WebhookSubscription {
  id: string;
  provider: string;
  projectId?: string;
  webhookUrl: string;
  verifyToken?: string;
  eventTypes: string[];
  isActive: boolean;
  eventsReceived: number;
  eventsProcessed: number;
  lastEventAt?: string;
  createdAt: string;
  project?: {
    id: string;
    name: string;
  };
  stats: {
    totalEvents: number;
    recentEvents: number;
    failedEvents: number;
    successRate: number;
  };
}

interface NewSubscription {
  provider: string;
  projectId?: string;
  eventTypes: string[];
  verifyToken?: string;
}

const PROVIDER_EVENT_TYPES = {
  X: [
    "POST_PUBLISHED",
    "POST_DELETED",
    "LIKE_RECEIVED",
    "RETWEET_RECEIVED",
    "REPLY_RECEIVED",
    "MENTION_RECEIVED",
  ],
  INSTAGRAM: [
    "POST_PUBLISHED",
    "POST_UPDATED",
    "COMMENT_RECEIVED",
    "MENTION_RECEIVED",
    "STORY_PUBLISHED",
    "STORY_EXPIRED",
  ],
  FACEBOOK: [
    "POST_PUBLISHED",
    "POST_UPDATED",
    "COMMENT_RECEIVED",
    "SHARE_RECEIVED",
    "MENTION_RECEIVED",
  ],
  YOUTUBE: [
    "VIDEO_PUBLISHED",
    "VIDEO_PROCESSED",
    "COMMENT_RECEIVED",
    "LIVE_STREAM_STARTED",
    "LIVE_STREAM_ENDED",
  ],
  TIKTOK: ["VIDEO_PUBLISHED", "COMMENT_RECEIVED", "SHARE_RECEIVED", "MENTION_RECEIVED"],
};

export function WebhookSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState<WebhookSubscription | null>(null);
  const [newSubscription, setNewSubscription] = useState<NewSubscription>({
    provider: "",
    eventTypes: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  const fetchSubscriptions = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/backend/api/webhooks/dashboard/subscriptions", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch subscriptions");
      }

      const data = await response.json();
      const payload = data.data ?? data;
      setSubscriptions(Array.isArray(payload) ? payload : (payload.subscriptions ?? []));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch("/api/backend/projects", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch {
      // Failed to fetch projects — select will show empty list
    }
  };

  useEffect(() => {
    fetchSubscriptions();
    fetchProjects();
  }, []);

  const createSubscription = async () => {
    try {
      const response = await fetch("/api/backend/api/webhooks/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(newSubscription),
      });

      if (!response.ok) {
        throw new Error("Failed to create subscription");
      }

      await fetchSubscriptions();
      setShowCreateDialog(false);
      setNewSubscription({ provider: "", eventTypes: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create subscription");
    }
  };

  const toggleSubscription = async (id: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/backend/api/webhooks/subscriptions/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });

      if (!response.ok) {
        throw new Error("Failed to update subscription");
      }

      await fetchSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription");
    }
  };

  const deleteSubscription = async (id: string) => {
    try {
      const response = await fetch(`/api/backend/api/webhooks/subscriptions/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete subscription");
      }

      await fetchSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete subscription");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getProviderBadge = (provider: string) => {
    const variantMap: Record<string, "info" | "error" | "neutral"> = {
      X: "neutral",
      INSTAGRAM: "error",
      FACEBOOK: "info",
      YOUTUBE: "error",
      TIKTOK: "neutral",
    };

    return <Badge variant={variantMap[provider] ?? "neutral"}>{provider}</Badge>;
  };

  const getHealthBadge = (successRate: number) => {
    if (successRate >= 95) return <Badge variant="success">Healthy</Badge>;
    if (successRate >= 90) return <Badge variant="warning">Warning</Badge>;
    return <Badge variant="error">Critical</Badge>;
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              Webhook Subscriptions
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Manage your webhook subscriptions for real-time social media events
            </p>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <ActionButton variant="primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Subscription
              </ActionButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Webhook Subscription</DialogTitle>
                <DialogDescription>
                  Set up a new webhook subscription to receive real-time events from social media
                  platforms.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="provider"
                    className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                  >
                    Provider
                  </label>
                  <select
                    id="provider"
                    value={newSubscription.provider}
                    onChange={(e) =>
                      setNewSubscription((prev) => ({
                        ...prev,
                        provider: e.target.value,
                        eventTypes: [],
                      }))
                    }
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">Select a provider</option>
                    <option value="X">X (Twitter)</option>
                    <option value="INSTAGRAM">Instagram</option>
                    <option value="FACEBOOK">Facebook</option>
                    <option value="YOUTUBE">YouTube</option>
                    <option value="TIKTOK">TikTok</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="project"
                    className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                  >
                    Project (Optional)
                  </label>
                  <select
                    id="project"
                    value={newSubscription.projectId || ""}
                    onChange={(e) =>
                      setNewSubscription((prev) => ({
                        ...prev,
                        ...(e.target.value && { projectId: e.target.value }),
                      }))
                    }
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                {newSubscription.provider && (
                  <div>
                    <span className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                      Event Types
                    </span>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {PROVIDER_EVENT_TYPES[
                        newSubscription.provider as keyof typeof PROVIDER_EVENT_TYPES
                      ]?.map((eventType) => (
                        <div key={eventType} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={eventType}
                            checked={newSubscription.eventTypes.includes(eventType)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewSubscription((prev) => ({
                                  ...prev,
                                  eventTypes: [...prev.eventTypes, eventType],
                                }));
                              } else {
                                setNewSubscription((prev) => ({
                                  ...prev,
                                  eventTypes: prev.eventTypes.filter((t) => t !== eventType),
                                }));
                              }
                            }}
                            className="rounded"
                          />
                          <label htmlFor={eventType} className="text-sm text-[var(--text-primary)]">
                            {eventType
                              .replace(/_/g, " ")
                              .toLowerCase()
                              .replace(/\b\w/g, (l) => l.toUpperCase())}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(newSubscription.provider === "FACEBOOK" ||
                  newSubscription.provider === "INSTAGRAM") && (
                  <div>
                    <label
                      htmlFor="verifyToken"
                      className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                    >
                      Verify Token (Optional)
                    </label>
                    <input
                      id="verifyToken"
                      value={newSubscription.verifyToken || ""}
                      onChange={(e) =>
                        setNewSubscription((prev) => ({ ...prev, verifyToken: e.target.value }))
                      }
                      placeholder="Custom verification token"
                      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2">
                <ActionButton variant="secondary" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={createSubscription}
                  disabled={!newSubscription.provider || newSubscription.eventTypes.length === 0}
                >
                  Create Subscription
                </ActionButton>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="p-4 pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-[var(--error)] mb-4">{error}</p>
            <ActionButton onClick={fetchSubscriptions} variant="secondary">
              Retry
            </ActionButton>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <p className="mb-4">No webhook subscriptions configured</p>
            <ActionButton variant="primary" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first subscription
            </ActionButton>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Provider
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Project
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Events
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Status
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Health
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Last Event
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr
                  key={subscription.id}
                  className="border-b border-[var(--border-subtle)] last:border-0"
                >
                  <td className="px-3 py-2">{getProviderBadge(subscription.provider)}</td>
                  <td className="px-3 py-2">
                    {subscription.project ? (
                      <span className="text-sm">{subscription.project.name}</span>
                    ) : (
                      <span className="text-sm text-[var(--text-secondary)]">All projects</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {subscription.eventTypes.slice(0, 2).map((eventType) => (
                        <Badge key={eventType} variant="neutral" size="sm">
                          {eventType
                            .replace(/_/g, " ")
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </Badge>
                      ))}
                      {subscription.eventTypes.length > 2 && (
                        <Badge variant="neutral" size="sm">
                          +{subscription.eventTypes.length - 2} more
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={subscription.isActive}
                        onClick={() => toggleSubscription(subscription.id, !subscription.isActive)}
                        className={[
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                          subscription.isActive ? "bg-[var(--accent)]" : "bg-[var(--bg-elevated)]",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform",
                            subscription.isActive ? "translate-x-4" : "translate-x-0",
                          ].join(" ")}
                        />
                      </button>
                      <span className="text-sm">
                        {subscription.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {getHealthBadge(Number(subscription.stats.successRate))}
                  </td>
                  <td className="px-3 py-2">
                    {subscription.lastEventAt ? (
                      <span className="text-sm text-[var(--text-secondary)]">
                        {formatDistanceToNow(new Date(subscription.lastEventAt), {
                          addSuffix: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-[var(--text-tertiary)]">Never</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center space-x-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowSetupDialog(subscription)}
                          >
                            <Settings className="h-4 w-4" />
                          </ActionButton>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Webhook Setup Instructions</DialogTitle>
                            <DialogDescription>
                              Configure {subscription.provider} to send webhooks to your endpoint
                            </DialogDescription>
                          </DialogHeader>
                          {showSetupDialog && (
                            <div className="space-y-4">
                              <div>
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  Webhook URL
                                </span>
                                <div className="flex items-center space-x-2 mt-1">
                                  <input
                                    value={subscription.webhookUrl}
                                    readOnly
                                    className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
                                  />
                                  <ActionButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => copyToClipboard(subscription.webhookUrl)}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </ActionButton>
                                </div>
                              </div>

                              {subscription.verifyToken && (
                                <div>
                                  <span className="text-sm font-medium text-[var(--text-primary)]">
                                    Verification Token
                                  </span>
                                  <div className="flex items-center space-x-2 mt-1">
                                    <input
                                      value={subscription.verifyToken}
                                      readOnly
                                      className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
                                    />
                                    <ActionButton
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => copyToClipboard(subscription.verifyToken!)}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </ActionButton>
                                  </div>
                                </div>
                              )}

                              <div>
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  Subscribed Events
                                </span>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {subscription.eventTypes.map((eventType) => (
                                    <Badge key={eventType} variant="neutral">
                                      {eventType
                                        .replace(/_/g, " ")
                                        .toLowerCase()
                                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                                    </Badge>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  Statistics
                                </span>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.totalEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      Total Events
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.recentEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      Last 24h
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.failedEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      Failed
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold text-[var(--success)]">
                                      {Number(subscription.stats.successRate).toFixed(1)}%
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      Success Rate
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <ActionButton variant="danger" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </ActionButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Webhook Subscription</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this webhook subscription? This action
                              cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteSubscription(subscription.id)}
                              className="bg-[var(--error)] hover:opacity-90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
