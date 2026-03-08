"use client";

/**
 * @file DeadLetterQueue.tsx
 * @description Dead letter queue management component for failed webhook events, providing
 * filtering, inspection, retry, and bulk operations on events that exhausted delivery attempts.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/ui";
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
  payload: Record<string, any>;
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

      const response = await fetch(`/api/webhooks/dashboard/dead-letter?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch dead letter events");
      }

      const data = await response.json();
      setEvents(data.events);
      setPagination((prev) => ({ ...prev, ...data.pagination }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.limit, filters.provider, filters.search]);

  const retryEvent = async (eventId: string) => {
    try {
      const response = await fetch(`/api/webhooks/dashboard/dead-letter/${eventId}/retry`, {
        method: "POST",
        credentials: "include",
      });

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
      const response = await fetch("/api/webhooks/dashboard/dead-letter/retry-all", {
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
    const colors = {
      X: "bg-black text-white",
      INSTAGRAM: "bg-pink-100 text-pink-800",
      FACEBOOK: "bg-blue-100 text-blue-800",
      YOUTUBE: "bg-red-100 text-red-800",
      TIKTOK: "bg-gray-100 text-gray-800",
    };

    return (
      <Badge
        variant="outline"
        className={colors[provider as keyof typeof colors] || "bg-gray-100 text-gray-800"}
      >
        {provider}
      </Badge>
    );
  };

  const formatEventType = (eventType: string) => {
    return eventType
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getSeverityColor = (retryCount: number) => {
    if (retryCount >= 5) return "text-red-600";
    if (retryCount >= 3) return "text-orange-600";
    return "text-yellow-600";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <span>Dead Letter Queue</span>
            </CardTitle>
            <CardDescription>
              Failed webhook events that require manual intervention
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            {events.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Retry All
                  </Button>
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
            <Button onClick={fetchDeadLetterEvents} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search by error or event type..."
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="pl-10"
            />
          </div>

          <Select
            value={filters.provider}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, provider: value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
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
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-600 mb-4">{error}</p>
            <Button onClick={fetchDeadLetterEvents} variant="outline">
              Retry
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No failed events</p>
            <p>All webhook events are processing successfully!</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Failure Reason</TableHead>
                  <TableHead>Retry Count</TableHead>
                  <TableHead>First Failed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{getProviderBadge(event.provider)}</TableCell>
                    <TableCell>
                      <span className="text-sm">{formatEventType(event.eventType)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        <p className="text-sm text-red-600 truncate" title={event.failureReason}>
                          {event.failureReason}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={getSeverityColor(event.retryCount)}>
                        {event.retryCount} retries
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {formatDistanceToNow(new Date(event.firstFailedAt), { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell>
                      {event.resolvedAt ? (
                        <Badge variant="default" className="bg-green-100 text-green-800">
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedEvent(event)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
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
                                        <Badge
                                          variant="default"
                                          className="bg-green-100 text-green-800"
                                        >
                                          Resolved
                                        </Badge>
                                      ) : (
                                        <Badge variant="destructive">Failed</Badge>
                                      )}
                                    </p>
                                  </div>
                                </div>

                                <div>
                                  <label className="text-sm font-medium text-red-600">
                                    Failure Reason
                                  </label>
                                  <p className="text-sm bg-red-50 p-3 rounded-sm border text-red-800">
                                    {selectedEvent.failureReason}
                                  </p>
                                </div>

                                <div>
                                  <label className="text-sm font-medium text-red-600">
                                    Final Error
                                  </label>
                                  <pre className="text-xs bg-red-50 p-3 rounded-sm border text-red-800 overflow-x-auto">
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
                                  <pre className="text-xs bg-gray-50 p-3 rounded-sm border overflow-x-auto">
                                    {JSON.stringify(selectedEvent.headers, null, 2)}
                                  </pre>
                                </div>

                                <div>
                                  <label className="text-sm font-medium">Payload</label>
                                  <pre className="text-xs bg-gray-50 p-3 rounded-sm border overflow-x-auto max-h-64">
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
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-gray-600">
                Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
                {pagination.total} failed events
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page === pagination.pages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
