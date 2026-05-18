"use client";

/**
 * @file DeadLetterQueue.tsx
 * @description Dead letter queue management component for failed webhook events, providing
 * filtering, inspection, retry, and bulk operations on events that exhausted delivery attempts.
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getErrorMessage } from "@packages/api-errors";
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
import {
  useDlqMetrics,
  useOutboxDeadLetter,
  useRetryOutboxDlq,
  useResolveOutboxDlq,
  useWebhookDeadLetterEvents,
  useRetryWebhookDeadLetter,
  useRetryAllWebhookDeadLetter,
  type DeadLetterEvent,
} from "@/hooks/api/useWebhooks";
import { ChevronDown, ChevronUp, Archive, Inbox } from "lucide-react";

/**
 * @component DeadLetterQueue
 * @description Dead letter queue management panel for failed webhook events. Provides filtering,
 *   payload inspection, individual and bulk retry, and resolution of permanently failed events.
 */
export function DeadLetterQueue() {
  const td = useTranslations("webhooks.deadLetter");
  const te = useTranslations("webhooks.events");
  const tc = useTranslations("common");
  const [selectedEvent, setSelectedEvent] = useState<DeadLetterEvent | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    provider: "all",
    search: "",
  });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [outboxExpanded, setOutboxExpanded] = useState(false);
  const [outboxPage, setOutboxPage] = useState(1);

  const { data: dlqMetrics } = useDlqMetrics();
  const { data: outboxData, isLoading: outboxLoading } = useOutboxDeadLetter(outboxPage);
  const retryOutbox = useRetryOutboxDlq();
  const resolveOutbox = useResolveOutboxDlq();

  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const eventsQuery = useWebhookDeadLetterEvents({
    page,
    limit: 20,
    provider: filters.provider,
    search: debouncedSearch,
  });
  const events = eventsQuery.data?.events ?? [];
  const pagination = eventsQuery.data?.pagination ?? { page, limit: 20, total: 0, pages: 0 };
  const isLoading = eventsQuery.isPending;
  const error = mutationError ?? (eventsQuery.isError ? getErrorMessage(eventsQuery.error) : null);

  const retryMutation = useRetryWebhookDeadLetter();
  const retryAllMutation = useRetryAllWebhookDeadLetter();

  const retryEvent = (eventId: string) => {
    retryMutation.mutate(eventId, {
      onSuccess: () => setMutationError(null),
      onError: (err) => setMutationError(getErrorMessage(err)),
    });
  };

  const bulkRetryAll = () => {
    retryAllMutation.mutate(undefined, {
      onSuccess: () => setMutationError(null),
      onError: (err) => setMutationError(getErrorMessage(err)),
    });
  };

  const fetchDeadLetterEvents = () => {
    void eventsQuery.refetch();
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

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center space-x-2 text-base font-semibold text-[var(--text-primary)]">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 text-[var(--error)]" />
              <span>{td("title")}</span>
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">{td("description")}</p>
          </div>
          <div className="flex items-center space-x-2">
            {events.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <ActionButton variant="secondary" size="sm">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {td("retryAll")}
                  </ActionButton>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{td("retryAllTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{td("retryAllDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={bulkRetryAll}>
                      {td("retryAllEvents")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <ActionButton onClick={fetchDeadLetterEvents} variant="secondary" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              {tc("refresh")}
            </ActionButton>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Unresolved</p>
            <p className="text-lg font-semibold text-[var(--error)]">
              {dlqMetrics ? dlqMetrics.unresolvedTotal : "-"}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Oldest</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {dlqMetrics?.oldestUnresolvedAt
                ? formatDistanceToNow(new Date(dlqMetrics.oldestUnresolvedAt), { addSuffix: true })
                : "-"}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Archived</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {dlqMetrics ? dlqMetrics.archivedTotal : "-"}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Outbox DLQ</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {dlqMetrics ? dlqMetrics.outboxDlqTotal : "-"}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-tertiary)] h-4 w-4" />
            <input
              placeholder={td("searchPlaceholder")}
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
            <option value="all">{tc("allProviders")}</option>
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
              {tc("retry")}
            </ActionButton>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)]">
            <AlertTriangle
              aria-hidden="true"
              className="h-12 w-12 mx-auto mb-4 text-[var(--text-tertiary)]"
            />
            <p className="text-lg font-medium mb-2">{td("noFailed")}</p>
            <p>{td("allProcessing")}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.provider")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.eventType")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.failureReason")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.retryCount")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.firstFailed")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.status")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    {td("table.actions")}
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
                        {td("retries", { count: event.retryCount })}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-sm text-[var(--text-secondary)]">
                        {formatDistanceToNow(new Date(event.firstFailedAt), { addSuffix: true })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {event.resolvedAt ? (
                        <Badge variant="success">{td("resolved")}</Badge>
                      ) : (
                        <Badge variant="error">{te("failed")}</Badge>
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
                              <DialogTitle>{td("details.title")}</DialogTitle>
                              <DialogDescription>
                                {td("details.eventId", {
                                  id:
                                    selectedEvent?.originalEvent?.eventId ||
                                    selectedEvent?.id ||
                                    "",
                                })}
                              </DialogDescription>
                            </DialogHeader>
                            {selectedEvent && (
                              <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <span className="text-sm font-medium">
                                      {td("details.provider")}
                                    </span>
                                    <p>{getProviderBadge(selectedEvent.provider)}</p>
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium">
                                      {td("details.eventType")}
                                    </span>
                                    <p className="text-sm">
                                      {formatEventType(selectedEvent.eventType)}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium">
                                      {td("details.retryCount")}
                                    </span>
                                    <p className="text-sm">
                                      {td("details.attempts", { count: selectedEvent.retryCount })}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium">
                                      {td("details.status")}
                                    </span>
                                    <p className="text-sm">
                                      {selectedEvent.resolvedAt ? (
                                        <Badge variant="success">{td("resolved")}</Badge>
                                      ) : (
                                        <Badge variant="error">{te("failed")}</Badge>
                                      )}
                                    </p>
                                  </div>
                                </div>

                                <div>
                                  <span className="text-sm font-medium text-[var(--error)]">
                                    {td("details.failureReason")}
                                  </span>
                                  <p className="text-sm bg-[var(--error-subtle)] p-3 rounded-sm border text-[var(--error)]">
                                    {selectedEvent.failureReason}
                                  </p>
                                </div>

                                <div>
                                  <span className="text-sm font-medium text-[var(--error)]">
                                    {td("details.finalError")}
                                  </span>
                                  <pre className="text-xs bg-[var(--error-subtle)] p-3 rounded-sm border text-[var(--error)] overflow-x-auto">
                                    {selectedEvent.finalError}
                                  </pre>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <span className="font-medium">
                                      {td("details.firstFailedAt")}
                                    </span>
                                    <p>{new Date(selectedEvent.firstFailedAt).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <span className="font-medium">{td("details.lastRetryAt")}</span>
                                    <p>{new Date(selectedEvent.lastRetryAt).toLocaleString()}</p>
                                  </div>
                                  {selectedEvent.resolvedAt && (
                                    <>
                                      <div>
                                        <span className="font-medium">
                                          {td("details.resolvedAt")}
                                        </span>
                                        <p>{new Date(selectedEvent.resolvedAt).toLocaleString()}</p>
                                      </div>
                                      {selectedEvent.resolvedBy && (
                                        <div>
                                          <span className="font-medium">
                                            {td("details.resolvedBy")}
                                          </span>
                                          <p>{selectedEvent.resolvedBy}</p>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>

                                <div>
                                  <span className="text-sm font-medium">
                                    {td("details.requestHeaders")}
                                  </span>
                                  <pre className="text-xs bg-[var(--bg-elevated)] p-3 rounded-sm border overflow-x-auto">
                                    {JSON.stringify(selectedEvent.headers, null, 2)}
                                  </pre>
                                </div>

                                <div>
                                  <span className="text-sm font-medium">
                                    {td("details.payload")}
                                  </span>
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
                                <AlertDialogTitle>{td("retryTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {td("retryDescription")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => retryEvent(event.id)}>
                                  {td("retryEvent")}
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
                {td("pagination.showing", {
                  from: (pagination.page - 1) * pagination.limit + 1,
                  to: Math.min(pagination.page * pagination.limit, pagination.total),
                  total: pagination.total,
                })}
              </div>
              <div className="flex items-center space-x-2">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                  onClick={() => setPage((p) => p + 1)}
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

      {/* Outbox Dead Letter collapsible section */}
      <div className="border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => setOutboxExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between p-4 text-left hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Inbox className="h-5 w-5 text-[var(--text-secondary)]" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              Outbox Dead Letter
            </span>
            {outboxData?.total != null && (
              <Badge variant={outboxData.total > 0 ? "error" : "success"}>{outboxData.total}</Badge>
            )}
          </div>
          {outboxExpanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
        </button>

        {outboxExpanded && (
          <div className="p-4 pt-0">
            {outboxLoading ? (
              <div className="flex items-center justify-center h-32">
                <LoadingSpinner size="md" />
              </div>
            ) : !outboxData?.items?.length ? (
              <div className="text-center py-6 text-[var(--text-secondary)]">
                <Archive className="h-10 w-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
                <p className="text-sm">No outbox dead-letter entries</p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                        Date
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                        Event Type
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                        Aggregate ID
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                        Retries
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {outboxData.items.map(
                      (item: {
                        id: string;
                        createdAt: string;
                        eventType: string;
                        aggregateId: string;
                        retryCount: number;
                      }) => (
                        <tr
                          key={item.id}
                          className="border-b border-[var(--border-subtle)] last:border-0"
                        >
                          <td className="px-3 py-2 text-[var(--text-secondary)]">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </td>
                          <td className="px-3 py-2">{item.eventType}</td>
                          <td className="px-3 py-2">
                            <span
                              className="font-mono text-xs text-[var(--text-secondary)]"
                              title={item.aggregateId}
                            >
                              {item.aggregateId.slice(0, 12)}...
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={item.retryCount >= 5 ? "error" : "warning"}>
                              {item.retryCount}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center space-x-2">
                              <ActionButton
                                variant="secondary"
                                size="sm"
                                onClick={() => retryOutbox.mutate(item.id)}
                                disabled={retryOutbox.isPending}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </ActionButton>
                              <ActionButton
                                variant="secondary"
                                size="sm"
                                onClick={() => resolveOutbox.mutate(item.id)}
                                disabled={resolveOutbox.isPending}
                              >
                                Resolve
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>

                {outboxData.total > outboxData.limit && (
                  <div className="flex items-center justify-end mt-4 space-x-2">
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setOutboxPage((p) => Math.max(1, p - 1))}
                      disabled={outboxPage <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </ActionButton>
                    <span className="text-sm text-[var(--text-secondary)]">Page {outboxPage}</span>
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setOutboxPage((p) => p + 1)}
                      disabled={outboxPage * outboxData.limit >= outboxData.total}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </ActionButton>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
