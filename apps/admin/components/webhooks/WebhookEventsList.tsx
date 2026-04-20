"use client";

/**
 * @file WebhookEventsList.tsx
 * @description Paginated list of webhook events with search, filtering by provider and status,
 * event payload inspection, and export functionality for webhook delivery audit trails.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@packages/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { Search, Eye, RefreshCw, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WebhookEvent {
  id: string;
  eventId: string;
  eventType: string;
  provider: string;
  status: string;
  verified: boolean;
  processed: boolean;
  retryCount: number;
  processingTime?: number;
  lastError?: string;
  receivedAt: string;
  processedAt?: string;
  nextRetryAt?: string;
  projectId?: string;
  postId?: string;
  channelId?: string;
}

interface WebhookEventsListProps {
  provider?: string;
  refreshTrigger?: string;
}

/**
 * @component WebhookEventsList
 * @description Paginated list of webhook events with search, provider/status filtering,
 *   payload inspection dialog, and CSV export for delivery audit trails.
 * @param props.provider - Optional provider filter applied on mount
 * @param props.refreshTrigger - When changed, forces a data refetch
 */
export function WebhookEventsList({ provider, refreshTrigger }: WebhookEventsListProps) {
  const te = useTranslations("webhooks.events");
  const tc = useTranslations("common");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });
  const [filters, setFilters] = useState({
    status: "all",
    search: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(provider && provider !== "all" && { provider }),
        ...(filters.status !== "all" && { status: filters.status }),
        ...(filters.search && { search: filters.search }),
      });

      const response = await fetch(`/api/backend/webhooks/dashboard/events?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw ApiError.fromResponse(response.status, body);
      }

      const data = await response.json();
      const payload = data.data ?? data;
      setEvents(payload.events ?? []);
      if (payload.pagination) {
        setPagination((prev) => ({ ...prev, ...payload.pagination }));
      }
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [provider, pagination.page, pagination.limit, filters.status, filters.search]);

  const fetchEventDetails = async (eventId: string) => {
    try {
      const response = await fetch(`/api/backend/webhooks/dashboard/events/${eventId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw ApiError.fromResponse(response.status, body);
      }

      const eventDetails = await response.json();
      setSelectedEvent(eventDetails);
    } catch {
      // Failed to fetch event details — selection state remains unchanged
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, provider, refreshTrigger, pagination.page, filters.status]);

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (pagination.page === 1) {
        fetchEvents();
      } else {
        setPagination((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(delayedSearch);
  }, [fetchEvents, filters.search, pagination.page]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge variant="success">{te("completed")}</Badge>;
      case "PROCESSING":
        return <Badge variant="info">{te("processing")}</Badge>;
      case "FAILED":
        return <Badge variant="error">{te("failed")}</Badge>;
      case "RETRYING":
        return <Badge variant="warning">{te("retrying")}</Badge>;
      case "DEAD_LETTER":
        return <Badge variant="error">{te("deadLetter")}</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
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

  const formatEventType = (eventType: string) => {
    return eventType
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const exportEvents = async () => {
    try {
      const params = new URLSearchParams({
        ...(provider && provider !== "all" && { provider }),
        ...(filters.status !== "all" && { status: filters.status }),
      });

      const response = await fetch(`/api/backend/webhooks/dashboard/export?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw ApiError.fromResponse(response.status, body);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `webhook-events-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // Export error toast pending UI notification package
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{te("title")}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{te("description")}</p>
          </div>
          <div className="flex items-center space-x-2">
            <ActionButton onClick={exportEvents} variant="secondary" size="sm">
              <Download className="h-4 w-4 mr-2" />
              {tc("export")}
            </ActionButton>
            <ActionButton onClick={fetchEvents} variant="secondary" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              {tc("refresh")}
            </ActionButton>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-tertiary)] h-4 w-4" />
            <input
              placeholder={te("searchPlaceholder")}
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="w-full pl-10 pr-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="w-32 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{te("allStatus")}</option>
            <option value="COMPLETED">{te("completed")}</option>
            <option value="PROCESSING">{te("processing")}</option>
            <option value="FAILED">{te("failed")}</option>
            <option value="RETRYING">{te("retrying")}</option>
            <option value="DEAD_LETTER">{te("deadLetter")}</option>
          </select>
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
            <ActionButton onClick={fetchEvents} variant="secondary">
              {tc("retry")}
            </ActionButton>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <p>{te("noEvents")}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.event")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.provider")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.type")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.status")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.processingTime")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.received")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {te("table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium text-sm">{event.eventId}</p>
                        {event.retryCount > 0 && (
                          <p className="text-xs text-[var(--warning)]">
                            {te("retried", { count: event.retryCount })}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{getProviderBadge(event.provider)}</td>
                    <td className="px-3 py-2">
                      <span className="text-sm">{formatEventType(event.eventType)}</span>
                    </td>
                    <td className="px-3 py-2">{getStatusBadge(event.status)}</td>
                    <td className="px-3 py-2">
                      {event.processingTime ? (
                        <span
                          className={`text-sm ${
                            event.processingTime < 100
                              ? "text-[var(--success)]"
                              : event.processingTime < 500
                                ? "text-[var(--warning)]"
                                : "text-[var(--error)]"
                          }`}
                        >
                          {event.processingTime}ms
                        </span>
                      ) : (
                        <span className="text-[var(--text-tertiary)] text-sm">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-sm text-[var(--text-secondary)]">
                        {formatDistanceToNow(new Date(event.receivedAt), { addSuffix: true })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => fetchEventDetails(event.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </ActionButton>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>{te("details.title")}</DialogTitle>
                            <DialogDescription>
                              {te("details.eventId", { id: selectedEvent?.eventId ?? "" })}
                            </DialogDescription>
                          </DialogHeader>
                          {selectedEvent && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="text-sm font-medium">
                                    {te("details.provider")}
                                  </label>
                                  <p>{getProviderBadge(selectedEvent.provider)}</p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">
                                    {te("details.status")}
                                  </label>
                                  <p>{getStatusBadge(selectedEvent.status)}</p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">
                                    {te("details.eventType")}
                                  </label>
                                  <p className="text-sm">
                                    {formatEventType(selectedEvent.eventType)}
                                  </p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">
                                    {te("details.verified")}
                                  </label>
                                  <p className="text-sm">
                                    {selectedEvent.verified ? (
                                      <Badge variant="success">{te("details.verified")}</Badge>
                                    ) : (
                                      <Badge variant="error">{te("details.notVerified")}</Badge>
                                    )}
                                  </p>
                                </div>
                              </div>

                              {selectedEvent.lastError && (
                                <div>
                                  <label className="text-sm font-medium text-[var(--error)]">
                                    {te("details.lastError")}
                                  </label>
                                  <p className="text-sm bg-[var(--error-subtle)] p-2 rounded-sm border">
                                    {selectedEvent.lastError}
                                  </p>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <label className="font-medium">{te("details.receivedAt")}</label>
                                  <p>{new Date(selectedEvent.receivedAt).toLocaleString()}</p>
                                </div>
                                {selectedEvent.processedAt && (
                                  <div>
                                    <label className="font-medium">
                                      {te("details.processedAt")}
                                    </label>
                                    <p>{new Date(selectedEvent.processedAt).toLocaleString()}</p>
                                  </div>
                                )}
                                {selectedEvent.nextRetryAt && (
                                  <div>
                                    <label className="font-medium">{te("details.nextRetry")}</label>
                                    <p>{new Date(selectedEvent.nextRetryAt).toLocaleString()}</p>
                                  </div>
                                )}
                                <div>
                                  <label className="font-medium">{te("details.retryCount")}</label>
                                  <p>{selectedEvent.retryCount}</p>
                                </div>
                              </div>

                              {(selectedEvent.projectId ||
                                selectedEvent.postId ||
                                selectedEvent.channelId) && (
                                <div>
                                  <label className="text-sm font-medium">
                                    {te("details.relatedEntities")}
                                  </label>
                                  <div className="text-sm space-y-1">
                                    {selectedEvent.projectId && (
                                      <p>
                                        {te("details.project", { id: selectedEvent.projectId })}
                                      </p>
                                    )}
                                    {selectedEvent.postId && (
                                      <p>{te("details.post", { id: selectedEvent.postId })}</p>
                                    )}
                                    {selectedEvent.channelId && (
                                      <p>
                                        {te("details.channel", { id: selectedEvent.channelId })}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-[var(--text-secondary)]">
                {te("pagination.showing", {
                  from: (pagination.page - 1) * pagination.limit + 1,
                  to: Math.min(pagination.page * pagination.limit, pagination.total),
                  total: pagination.total,
                })}
              </div>
              <div className="flex items-center space-x-2">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {tc("previous")}
                </ActionButton>
                <span className="text-sm">
                  {tc("page", { current: pagination.page, total: pagination.pages })}
                </span>
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page === pagination.pages}
                >
                  {tc("next")}
                  <ChevronRight className="h-4 w-4" />
                </ActionButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
