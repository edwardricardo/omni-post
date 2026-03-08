"use client";

/**
 * @file PublishDialog.tsx
 * @description Modal dialog wrapping the publishing workflow with tabs for publish,
 * preview, and schedule, coordinating provider selection and the PublishingInterface.
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@packages/ui";
import { Button } from "@packages/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@packages/ui";
import { Send, Calendar, Eye, Settings } from "lucide-react";
import { PublishingInterface } from "./PublishingInterface";
import { PlatformPreview } from "../editor/PlatformPreview";
import { SchedulePicker } from "../editor/SchedulePicker";
import { useProviders } from "@/lib/hooks/useProviders";
import { providerRegistry } from "@/lib/providers/registry";

interface PublishDialogProps {
  content: string;
  mediaFiles: File[];
  selectedProviders: string[];
  onProvidersChange?: (providers: string[]) => void;
  postId?: string;
  trigger?: React.ReactNode;
  onPublishSuccess?: (results: any[]) => void;
  onPublishError?: (error: Error) => void;
}

export function PublishDialog({
  content,
  mediaFiles,
  selectedProviders,
  onProvidersChange,
  postId,
  trigger,
  onPublishSuccess,
  onPublishError,
}: PublishDialogProps) {
  const { enabledProviders, getProviderConfig } = useProviders();
  const [isOpen, setIsOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [activeTab, setActiveTab] = useState("publish");
  const [localSelectedProviders, setLocalSelectedProviders] = useState<string[]>(selectedProviders);

  // Update local state when props change
  useEffect(() => {
    setLocalSelectedProviders(selectedProviders);
  }, [selectedProviders]);

  const handleProviderToggle = (providerId: string) => {
    const newProviders = localSelectedProviders.includes(providerId)
      ? localSelectedProviders.filter((id) => id !== providerId)
      : [...localSelectedProviders, providerId];

    setLocalSelectedProviders(newProviders);
    onProvidersChange?.(newProviders);
  };

  const handleSchedule = (date: Date) => {
    setScheduledDate(date);
    setActiveTab("publish");
  };

  const handlePublishSuccess = (results: any[]) => {
    setIsOpen(false);
    onPublishSuccess?.(results);
  };

  const canPublish = content.trim().length > 0 && localSelectedProviders.length > 0;

  // Get validation results for all selected providers
  const validationErrors = localSelectedProviders.reduce(
    (acc, providerId) => {
      const validation = providerRegistry.validateContent(providerId, content, mediaFiles);
      if (!validation.valid) {
        const config = getProviderConfig(providerId);
        acc.push({
          provider: config?.displayName || providerId,
          errors: validation.errors,
        });
      }
      return acc;
    },
    [] as Array<{ provider: string; errors: string[] }>
  );

  const hasErrors = validationErrors.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button disabled={!canPublish}>
            <Send className="h-4 w-4 mr-2" />
            Publish
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{scheduledDate ? "Schedule Post" : "Publish Post"}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="platforms" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Platforms
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Schedule
            </TabsTrigger>
            <TabsTrigger value="publish" className="flex items-center gap-2" disabled={hasErrors}>
              <Send className="h-4 w-4" />
              Publish
            </TabsTrigger>
          </TabsList>

          <TabsContent value="platforms" className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Platforms</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {enabledProviders.map((provider) => {
                  const config = getProviderConfig(provider.name);
                  if (!config) return null;

                  const isSelected = localSelectedProviders.includes(provider.name);
                  const validation = providerRegistry.validateContent(
                    provider.name,
                    content,
                    mediaFiles
                  );

                  return (
                    <div
                      key={provider.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        isSelected
                          ? validation.valid
                            ? "border-green-500 bg-green-50"
                            : "border-red-500 bg-red-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => handleProviderToggle(provider.name)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-xs"
                            style={{ backgroundColor: config.color }}
                          />
                          <span className="font-medium">{config.displayName}</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleProviderToggle(provider.name)}
                          className="rounded"
                        />
                      </div>

                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>Character limit: {config.charLimit.toLocaleString()}</div>
                        <div>Media limit: {config.mediaLimits.maxFiles} files</div>
                        <div>
                          Features:{" "}
                          {Object.entries(config.features)
                            .filter(([, enabled]) => enabled)
                            .map(([feature]) => feature)
                            .join(", ")}
                        </div>
                      </div>

                      {isSelected && !validation.valid && (
                        <div className="mt-2 text-sm text-red-600">
                          <ul className="list-disc list-inside">
                            {validation.errors.map((error, index) => (
                              <li key={index}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {isSelected &&
                        validation.valid &&
                        providerRegistry.needsThreading(provider.name, content) && (
                          <div className="mt-2 text-sm text-orange-600">
                            Will be posted as a thread (
                            {providerRegistry.getThreadSegments(provider.name, content).length}{" "}
                            parts)
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>

              {localSelectedProviders.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  Select at least one platform to publish to
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="space-y-4">
            {localSelectedProviders.length > 0 ? (
              <PlatformPreview
                content={content}
                mediaFiles={mediaFiles}
                selectedProviders={localSelectedProviders}
              />
            ) : (
              <div className="text-center text-muted-foreground py-8">
                Select platforms to see preview
              </div>
            )}
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4">
            <SchedulePicker
              isOpen={true}
              onClose={() => {}}
              onSchedule={handleSchedule}
              selectedProviders={localSelectedProviders}
              inline={true}
            />

            {scheduledDate && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="font-medium text-blue-900">
                  Scheduled for: {scheduledDate.toLocaleString()}
                </div>
                <div className="text-sm text-blue-700 mt-1">
                  Your post will be automatically published at this time.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScheduledDate(undefined)}
                  className="mt-2"
                >
                  Clear Schedule
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="publish" className="space-y-4">
            <PublishingInterface
              content={content}
              mediaFiles={mediaFiles}
              selectedProviders={localSelectedProviders}
              {...(scheduledDate && { scheduledDate })}
              {...(postId && { postId })}
              onPublishSuccess={handlePublishSuccess}
              {...(onPublishError && { onPublishError })}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
