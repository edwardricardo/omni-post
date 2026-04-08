"use client";

/**
 * @file DeadLetterQueue.tsx
 * @description Dead letter queue management component for failed webhook events, providing
 * filtering, inspection, retry, and bulk operations on events that exhausted delivery attempts.
 */

import { useState, useEffect, useCallback } from "react";
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
  Search,
  Eye,
  RotateCcw,
  Trash2 as _Trash2,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface DeadLetterEvent {
  id: string;
  provider: string;
  eventType: string;
  failureReason: string;
  finalError: string;
  retryCount: number;
  firstFailedAt: string;
  lastRetryAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  originalEvent?: {
    id: string;
    eventId: string;
    accountId: string;
  };
}

export function DeadLetterQueue() {
  const [events, setEvents] = useState<DeadLetterEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<DeadLetterEvent | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });
  const [filters, setFilters] = useState({
    provider: "all",
    search: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeadLetterEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(filters.provider !== "all" && { provider: filters.provider }),
        ...(filters.search && { search: filters.search }),
      });

      const response = await fetch(`/api/backend/api/webhooks/dashboard/dead-letter?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch dead letter events");
      }

      const data = await response.json();
      const payload = data.data ?? data;
      setEvents(payload.events ?? []);
      if (payload.pagination) {
        setPagination((prev) => ({ ...prev, ...payload.pagination }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.limit, filters.provider, filters.search]);

  const retryEvent = async (eventId: string) => {
    try {
      const response = await fetch(
        `/api/backend/api/webhooks/dashboard/dead-letter/${eventId}/retry`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to retry event");
      }

      // Refresh the list
      await fetchDeadLetterEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry event");
    }
  };

  const bulkRetryAll = async () => {
    try {
      // This would need to be implemented in the API
      const response = await fetch("/api/backend/api/webhooks/dashboard/dead-letter/retry-all", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to retry all events");
      }

      await fetchDeadLetterEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry all events");
    }
  };

  useEffect(() => {
    fetchDeadLetterEvents();
  }, [fetchDeadLetterEvents, pagination.page, filters.provider]);

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (pagination.page === 1) {
        fetchDeadLetterEvents();
      } else {
        setPagination((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(delayedSearch);
  }, [fetchDeadLetterEvents, filters.search, pagination.page]);

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

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center space-x-2 text-base font-semibold text-[var(--text-primary)]">
              <AlertTriangle className="h-5 w-5 text-[var(--error)]" />
              <span>Dead Letter Queue</span>
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Failed webhook events that require manual intervention
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {events.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <ActionButton variant="secondary" size="sm">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Retry All
                  </ActionButton>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Retry All Failed Events</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will attempt to reprocess all failed events in the dead letter queue. Are
                      you sure you want to continue?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={bulkRetryAll}>Retry All Events</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <ActionButton onClick={fetchDeadLetterEvents} variant="secondary" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </ActionButton>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-tertiary)] h-4 w-4" />
            <input
              placeholder="Search by error or event type..."
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="w-full pl-10 pr-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <select
            value={filters.provider}
            onChange={(e) => setFilters((prev) => ({ ...prev, provider: e.target.value }))}
            className="w-40 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">All Providers</option>
            <option value="X">X (Twitter)</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="YOUTUBE">YouTube</option>
            <option value="TIKTOK">TikTok</option>
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
            <ActionButton onClick={fetchDeadLetterEvents} variant="secondary">
              Retry
            </ActionButton>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
            <p className="text-lg font-medium mb-2">No failed events</p>
            <p>All webhook events are processing successfully!</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Provider
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Event Type
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Failure Reason
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Retry Count
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    First Failed
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="px-3 py-2">{getProviderBadge(event.provider)}</td>
                    <td className="px-3 py-2">
                      <span className="text-sm">{formatEventType(event.eventType)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-xs">
                        <p
                          className="text-sm text-[var(--error)] truncate"
                          title={event.failureReason}
                        >
                          {event.failureReason}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={event.retryCount >= 5 ? "error" : "warning"}>
                        {event.retryCount} retries
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-sm text-[var(--text-secondary)]">
                        {formatDistanceToNow(new Date(event.firstFailedAt), { addSuffix: true })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {event.resolvedAt ? (
                        <Badge variant="success">Resolved</Badge>
                      ) : (
                        <Badge variant="error">Failed</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <ActionButton
                              variant="secondary"
                              size="sm"
                              onClick={() => setSelectedEvent(event)}
                            >
                              <Eye className="h-4 w-4" />
                            </ActionButton>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Dead Letter Event Details</DialogTitle>
                              <DialogDescription>
                                Event ID:{" "}
                                {selectedEvent?.originalEvent?.eventId || selectedEvent?.id}
                              </DialogDescription>
                            </DialogHeader>
                            {selectedEvent && (
                              <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className="text-sm font-medium">Provider</label>
                                    <p>{getProviderBadge(selectedEvent.provider)}</p>
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">Event Type</label>
                                    <p className="text-sm">
                                      {formatEventType(selectedEvent.eventType)}
                                    </p>
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">Retry Count</label>
                                    <p className="text-sm">{selectedEvent.retryCount} attempts</p>
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">Status</label>
                                    <p className="text-sm">
                                      {selectedEvent.resolvedAt ? (
                                        <Badge variant="success">Resolved</Badge>
                                      ) : (
                                        <Badge variant="error">Failed</Badge>
                                      )}
                                    </p>
                                  </div>
                                </div>

                                <div>
                                  <label className="text-sm font-medium text-[var(--error)]">
                                    Failure Reason
                                  </label>
                                  <p className="text-sm bg-[var(--error-subtle)] p-3 rounded-sm border text-[var(--error)]">
                                    {selectedEvent.failureReason}
                                  </p>
                                </div>

                                <div>
                                  <label className="text-sm font-medium text-[var(--error)]">
                                    Final Error
                                  </label>
                                  <pre className="text-xs bg-[var(--error-subtle)] p-3 rounded-sm border text-[var(--error)] overflow-x-auto">
                                    {selectedEvent.finalError}
                                  </pre>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <label className="font-medium">First Failed At</label>
                                    <p>{new Date(selectedEvent.firstFailedAt).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <label className="font-medium">Last Retry At</label>
                                    <p>{new Date(selectedEvent.lastRetryAt).toLocaleString()}</p>
                                  </div>
                                  {selectedEvent.resolvedAt && (
                                    <>
                                      <div>
                                        <label className="font-medium">Resolved At</label>
                                        <p>{new Date(selectedEvent.resolvedAt).toLocaleString()}</p>
                                      </div>
                                      {selectedEvent.resolvedBy && (
                                        <div>
                                          <label className="font-medium">Resolved By</label>
                                          <p>{selectedEvent.resolvedBy}</p>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>

                                <div>
                                  <label className="text-sm font-medium">Request Headers</label>
                                  <pre className="text-xs bg-[var(--bg-elevated)] p-3 rounded-sm border overflow-x-auto">
                                    {JSON.stringify(selectedEvent.headers, null, 2)}
                                  </pre>
                                </div>

                                <div>
                                  <label className="text-sm font-medium">Payload</label>
                                  <pre className="text-xs bg-[var(--bg-elevated)] p-3 rounded-sm border overflow-x-auto max-h-64">
                                    {JSON.stringify(selectedEvent.payload, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>

                        {!event.resolvedAt && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <ActionButton variant="secondary" size="sm">
                                <RotateCcw className="h-4 w-4" />
                              </ActionButton>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Retry Failed Event</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will attempt to reprocess the failed webhook event. Are you
                                  sure you want to retry this event?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => retryEvent(event.id)}>
                                  Retry Event
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-[var(--text-secondary)]">
                Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
                {pagination.total} failed events
              </div>
              <div className="flex items-center space-x-2">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </ActionButton>
                <span className="text-sm">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page === pagination.pages}
                >
                  Next
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
