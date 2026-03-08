"use client";

/**
 * @file WebhookSubscriptions.tsx
 * @description Webhook subscription management component for creating, editing, toggling,
 * and deleting webhook endpoints with provider, event type, and URL configuration.
 */

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Switch,
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea as _Textarea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/ui";
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
      const response = await fetch("/api/webhooks/dashboard/subscriptions", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch subscriptions");
      }

      const data = await response.json();
      setSubscriptions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch("/api/projects", {
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
      const response = await fetch("/api/webhooks/subscriptions", {
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
      const response = await fetch(`/api/webhooks/subscriptions/${id}`, {
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
      const response = await fetch(`/api/webhooks/subscriptions/${id}`, {
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Webhook Subscriptions</CardTitle>
            <CardDescription>
              Manage your webhook subscriptions for real-time social media events
            </CardDescription>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Subscription
              </Button>
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
                  <Label htmlFor="provider">Provider</Label>
                  <Select
                    value={newSubscription.provider}
                    onValueChange={(value) =>
                      setNewSubscription((prev) => ({
                        ...prev,
                        provider: value,
                        eventTypes: [], // Reset event types when provider changes
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="X">X (Twitter)</SelectItem>
                      <SelectItem value="INSTAGRAM">Instagram</SelectItem>
                      <SelectItem value="FACEBOOK">Facebook</SelectItem>
                      <SelectItem value="YOUTUBE">YouTube</SelectItem>
                      <SelectItem value="TIKTOK">TikTok</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="project">Project (Optional)</Label>
                  <Select
                    value={newSubscription.projectId || ""}
                    onValueChange={(value) =>
                      setNewSubscription((prev) => ({
                        ...prev,
                        ...(value && { projectId: value }),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All projects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All projects</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {newSubscription.provider && (
                  <div>
                    <Label>Event Types</Label>
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
                          <Label htmlFor={eventType} className="text-sm">
                            {eventType
                              .replace(/_/g, " ")
                              .toLowerCase()
                              .replace(/\b\w/g, (l) => l.toUpperCase())}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(newSubscription.provider === "FACEBOOK" ||
                  newSubscription.provider === "INSTAGRAM") && (
                  <div>
                    <Label htmlFor="verifyToken">Verify Token (Optional)</Label>
                    <Input
                      id="verifyToken"
                      value={newSubscription.verifyToken || ""}
                      onChange={(e) =>
                        setNewSubscription((prev) => ({ ...prev, verifyToken: e.target.value }))
                      }
                      placeholder="Custom verification token"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={createSubscription}
                  disabled={!newSubscription.provider || newSubscription.eventTypes.length === 0}
                >
                  Create Subscription
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
            <Button onClick={fetchSubscriptions} variant="outline">
              Retry
            </Button>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="mb-4">No webhook subscriptions configured</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first subscription
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Last Event</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription.id}>
                  <TableCell>{getProviderBadge(subscription.provider)}</TableCell>
                  <TableCell>
                    {subscription.project ? (
                      <span className="text-sm">{subscription.project.name}</span>
                    ) : (
                      <span className="text-sm text-gray-500">All projects</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {subscription.eventTypes.slice(0, 2).map((eventType) => (
                        <Badge key={eventType} variant="secondary" className="text-xs">
                          {eventType
                            .replace(/_/g, " ")
                            .toLowerCase()
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </Badge>
                      ))}
                      {subscription.eventTypes.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{subscription.eventTypes.length - 2} more
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={subscription.isActive}
                        onCheckedChange={(checked) => toggleSubscription(subscription.id, checked)}
                      />
                      <span className="text-sm">
                        {subscription.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{getHealthBadge(subscription.stats.successRate)}</TableCell>
                  <TableCell>
                    {subscription.lastEventAt ? (
                      <span className="text-sm text-gray-600">
                        {formatDistanceToNow(new Date(subscription.lastEventAt), {
                          addSuffix: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSetupDialog(subscription)}
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
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
                                <Label className="text-sm font-medium">Webhook URL</Label>
                                <div className="flex items-center space-x-2 mt-1">
                                  <Input
                                    value={subscription.webhookUrl}
                                    readOnly
                                    className="bg-gray-50"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyToClipboard(subscription.webhookUrl)}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {subscription.verifyToken && (
                                <div>
                                  <Label className="text-sm font-medium">Verification Token</Label>
                                  <div className="flex items-center space-x-2 mt-1">
                                    <Input
                                      value={subscription.verifyToken}
                                      readOnly
                                      className="bg-gray-50"
                                    />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => copyToClipboard(subscription.verifyToken!)}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              )}

                              <div>
                                <Label className="text-sm font-medium">Subscribed Events</Label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {subscription.eventTypes.map((eventType) => (
                                    <Badge key={eventType} variant="secondary">
                                      {eventType
                                        .replace(/_/g, " ")
                                        .toLowerCase()
                                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                                    </Badge>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <Label className="text-sm font-medium">Statistics</Label>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {subscription.stats.totalEvents.toLocaleString()}
                                    </div>
                                    <div className="text-sm text-gray-600">Total Events</div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {subscription.stats.recentEvents.toLocaleString()}
                                    </div>
                                    <div className="text-sm text-gray-600">Last 24h</div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold">
                                      {subscription.stats.failedEvents.toLocaleString()}
                                    </div>
                                    <div className="text-sm text-gray-600">Failed</div>
                                  </div>
                                  <div>
                                    <div className="text-2xl font-bold text-green-600">
                                      {subscription.stats.successRate.toFixed(1)}%
                                    </div>
                                    <div className="text-sm text-gray-600">Success Rate</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
