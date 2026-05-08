"use client";

/**
 * @file WebhookSubscriptions.tsx
 * @description Webhook subscription management component for creating, editing, toggling,
 * and deleting webhook endpoints with provider, event type, and URL configuration.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "@/lib/parseApiError";
import {
  useWebhookSubscriptions,
  useProjectsForSubscriptionForm,
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
  useDeleteWebhookSubscription,
  type WebhookSubscription,
} from "@/hooks/api/useWebhooks";
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

/**
 * @component WebhookSubscriptions
 * @description Webhook subscription management panel for creating, editing, toggling,
 *   and deleting webhook endpoints with provider, event type, and URL configuration.
 */
export function WebhookSubscriptions() {
  const tsp = useTranslations("webhooks.subscriptionsPanel");
  const tc = useTranslations("common");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState<WebhookSubscription | null>(null);
  const [newSubscription, setNewSubscription] = useState<NewSubscription>({
    provider: "",
    eventTypes: [],
  });
  const [mutationError, setMutationError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data — TanStack Query (T3-N migration from manual fetch + setState)
  // ---------------------------------------------------------------------------

  const subscriptionsQuery = useWebhookSubscriptions();
  const projectsQuery = useProjectsForSubscriptionForm();
  const subscriptions = subscriptionsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const isLoading = subscriptionsQuery.isPending;
  const error =
    mutationError ??
    (subscriptionsQuery.isError ? getErrorMessage(subscriptionsQuery.error) : null);

  const createMutation = useCreateWebhookSubscription();
  const updateMutation = useUpdateWebhookSubscription();
  const deleteMutation = useDeleteWebhookSubscription();

  const createSubscription = () => {
    createMutation.mutate(newSubscription, {
      onSuccess: () => {
        setMutationError(null);
        setShowCreateDialog(false);
        setNewSubscription({ provider: "", eventTypes: [] });
      },
      onError: (err) => setMutationError(getErrorMessage(err)),
    });
  };

  const toggleSubscription = (id: string, isActive: boolean) => {
    updateMutation.mutate(
      { id, data: { isActive } },
      {
        onSuccess: () => setMutationError(null),
        onError: (err) => setMutationError(getErrorMessage(err)),
      }
    );
  };

  const deleteSubscription = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => setMutationError(null),
      onError: (err) => setMutationError(getErrorMessage(err)),
    });
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
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{tsp("title")}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{tsp("description")}</p>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <ActionButton variant="primary">
                <Plus className="h-4 w-4 mr-2" />
                {tsp("addSubscription")}
              </ActionButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tsp("createTitle")}</DialogTitle>
                <DialogDescription>{tsp("createDescription")}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="provider"
                    className="block text-sm font-medium text-[var(--text-primary)] mb-1"
                  >
                    {tsp("provider")}
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
                    <option value="">{tsp("selectProvider")}</option>
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
                    {tsp("projectOptional")}
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
                    <option value="">{tsp("allProjects")}</option>
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
                      {tsp("eventTypes")}
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
                      {tsp("verifyToken")}
                    </label>
                    <input
                      id="verifyToken"
                      value={newSubscription.verifyToken || ""}
                      onChange={(e) =>
                        setNewSubscription((prev) => ({ ...prev, verifyToken: e.target.value }))
                      }
                      placeholder={tsp("verifyTokenPlaceholder")}
                      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2">
                <ActionButton variant="secondary" onClick={() => setShowCreateDialog(false)}>
                  {tc("cancel")}
                </ActionButton>
                <ActionButton
                  variant="primary"
                  onClick={createSubscription}
                  disabled={!newSubscription.provider || newSubscription.eventTypes.length === 0}
                >
                  {tsp("createSubscription")}
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
            <ActionButton onClick={() => subscriptionsQuery.refetch()} variant="secondary">
              {tc("retry")}
            </ActionButton>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <p className="mb-4">{tsp("noSubscriptions")}</p>
            <ActionButton variant="primary" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {tsp("createFirst")}
            </ActionButton>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.provider")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.project")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.events")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.status")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.health")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.lastEvent")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                  {tsp("table.actions")}
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
                      <span className="text-sm text-[var(--text-secondary)]">
                        {tsp("allProjects")}
                      </span>
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
                          {tsp("moreEvents", { count: subscription.eventTypes.length - 2 })}
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
                        {subscription.isActive ? tc("active") : tc("inactive")}
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
                      <span className="text-sm text-[var(--text-tertiary)]">{tc("never")}</span>
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
                            <DialogTitle>{tsp("setupTitle")}</DialogTitle>
                            <DialogDescription>
                              {tsp("setupDescription", { provider: subscription.provider })}
                            </DialogDescription>
                          </DialogHeader>
                          {showSetupDialog && (
                            <div className="space-y-4">
                              <div>
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  {tsp("webhookUrl")}
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
                                    {tsp("verificationToken")}
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
                                  {tsp("subscribedEvents")}
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
                                  {tsp("statistics")}
                                </span>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.totalEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      {tsp("totalEvents")}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.recentEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      {tsp("last24h")}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {Number(subscription.stats.failedEvents).toLocaleString()}
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      {tsp("failedEvents")}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold text-[var(--success)]">
                                      {Number(subscription.stats.successRate).toFixed(1)}%
                                    </div>
                                    <div className="text-sm text-[var(--text-secondary)]">
                                      {tsp("successRate")}
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
                            <AlertDialogTitle>{tsp("deleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {tsp("deleteDescription")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteSubscription(subscription.id)}
                              className="bg-[var(--error)] hover:opacity-90"
                            >
                              {tc("delete")}
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
