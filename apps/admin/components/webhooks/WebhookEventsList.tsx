"use client";

/**
 * @file WebhookEventsList.tsx
 * @description Paginated list of webhook events with search, filtering by provider and status,
 * event payload inspection, and export functionality for webhook delivery audit trails.
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/ui";
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

export function WebhookEventsList({ provider, refreshTrigger }: WebhookEventsListProps) {
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

      const response = await fetch(`/api/webhooks/dashboard/events?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch webhook events");
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
  }, [provider, pagination.page, pagination.limit, filters.status, filters.search]);

  const fetchEventDetails = async (eventId: string) => {
    try {
      const response = await fetch(`/api/webhooks/dashboard/events/${eventId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch event details");
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
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            Completed
          </Badge>
        );
      case "PROCESSING":
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            Processing
          </Badge>
        );
      case "FAILED":
        return <Badge variant="destructive">Failed</Badge>;
      case "RETRYING":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            Retrying
          </Badge>
        );
      case "DEAD_LETTER":
        return (
          <Badge variant="destructive" className="bg-red-100 text-red-800">
            Dead Letter
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

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

  const exportEvents = async () => {
    try {
      const params = new URLSearchParams({
        ...(provider && provider !== "all" && { provider }),
        ...(filters.status !== "all" && { status: filters.status }),
      });

      const response = await fetch(`/api/webhooks/dashboard/export?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to export events");
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Webhook Events</CardTitle>
            <CardDescription>Recent webhook events and their processing status</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Button onClick={exportEvents} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button onClick={fetchEvents} variant="outline" size="sm">
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
              placeholder="Search events..."
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="pl-10"
            />
          </div>

          <Select
            value={filters.status}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="RETRYING">Retrying</SelectItem>
              <SelectItem value="DEAD_LETTER">Dead Letter</SelectItem>
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
            <Button onClick={fetchEvents} variant="outline">
              Retry
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No webhook events found</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processing Time</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{event.eventId}</p>
                        {event.retryCount > 0 && (
                          <p className="text-xs text-yellow-600">
                            Retried {event.retryCount} times
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getProviderBadge(event.provider)}</TableCell>
                    <TableCell>
                      <span className="text-sm">{formatEventType(event.eventType)}</span>
                    </TableCell>
                    <TableCell>{getStatusBadge(event.status)}</TableCell>
                    <TableCell>
                      {event.processingTime ? (
                        <span
                          className={`text-sm ${
                            event.processingTime < 100
                              ? "text-green-600"
                              : event.processingTime < 500
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {event.processingTime}ms
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {formatDistanceToNow(new Date(event.receivedAt), { addSuffix: true })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => fetchEventDetails(event.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Webhook Event Details</DialogTitle>
                            <DialogDescription>
                              Event ID: {selectedEvent?.eventId}
                            </DialogDescription>
                          </DialogHeader>
                          {selectedEvent && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="text-sm font-medium">Provider</label>
                                  <p>{getProviderBadge(selectedEvent.provider)}</p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">Status</label>
                                  <p>{getStatusBadge(selectedEvent.status)}</p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">Event Type</label>
                                  <p className="text-sm">
                                    {formatEventType(selectedEvent.eventType)}
                                  </p>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">Verified</label>
                                  <p className="text-sm">
                                    {selectedEvent.verified ? (
                                      <Badge
                                        variant="default"
                                        className="bg-green-100 text-green-800"
                                      >
                                        Verified
                                      </Badge>
                                    ) : (
                                      <Badge variant="destructive">Not Verified</Badge>
                                    )}
                                  </p>
                                </div>
                              </div>

                              {selectedEvent.lastError && (
                                <div>
                                  <label className="text-sm font-medium text-red-600">
                                    Last Error
                                  </label>
                                  <p className="text-sm bg-red-50 p-2 rounded-sm border">
                                    {selectedEvent.lastError}
                                  </p>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <label className="font-medium">Received At</label>
                                  <p>{new Date(selectedEvent.receivedAt).toLocaleString()}</p>
                                </div>
                                {selectedEvent.processedAt && (
                                  <div>
                                    <label className="font-medium">Processed At</label>
                                    <p>{new Date(selectedEvent.processedAt).toLocaleString()}</p>
                                  </div>
                                )}
                                {selectedEvent.nextRetryAt && (
                                  <div>
                                    <label className="font-medium">Next Retry</label>
                                    <p>{new Date(selectedEvent.nextRetryAt).toLocaleString()}</p>
                                  </div>
                                )}
                                <div>
                                  <label className="font-medium">Retry Count</label>
                                  <p>{selectedEvent.retryCount}</p>
                                </div>
                              </div>

                              {(selectedEvent.projectId ||
                                selectedEvent.postId ||
                                selectedEvent.channelId) && (
                                <div>
                                  <label className="text-sm font-medium">Related Entities</label>
                                  <div className="text-sm space-y-1">
                                    {selectedEvent.projectId && (
                                      <p>Project: {selectedEvent.projectId}</p>
                                    )}
                                    {selectedEvent.postId && <p>Post: {selectedEvent.postId}</p>}
                                    {selectedEvent.channelId && (
                                      <p>Channel: {selectedEvent.channelId}</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
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
                {pagination.total} events
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
