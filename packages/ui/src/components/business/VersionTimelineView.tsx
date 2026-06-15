/**
 * @file VersionTimelineView.tsx
 * @description Timeline tab for ContentVersioning that renders each version as a card on a
 *              Git-style vertical timeline. Stateless; all data comes from parent orchestrator.
 * @component VersionTimelineView
 * @layer infrastructure
 */

"use client";

import {
  Plus,
  Edit,
  GitBranch,
  ArrowRight,
  FileText,
  Trash2,
  Clock,
  Eye,
  User,
  MessageSquare,
  RotateCcw,
  Diff,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader } from "../card.js";
import { Button } from "../button.js";
import { Badge } from "../badge.js";
import type { ContentVersion } from "./contentVersioningTypes.js";
import {
  getTextContent,
  getAuthorName,
  getVersionMedia,
  getChangeTypeLabel,
} from "./contentVersioningTypes.js";

// ---------------------------------------------------------------------------
// Icon resolver (JSX version — kept local to avoid circular dep)
// ---------------------------------------------------------------------------

function ChangeTypeIcon({ changeType }: { changeType: ContentVersion["changeType"] }) {
  switch (changeType) {
    case "create":
    case "created":
      return <Plus className="h-4 w-4 text-green-500" />;
    case "edit":
    case "edited":
      return <Edit className="h-4 w-4 text-blue-500" />;
    case "branch":
      return <GitBranch className="h-4 w-4 text-purple-500" />;
    case "merge":
      return <ArrowRight className="h-4 w-4 text-orange-500" />;
    case "media_added":
      return <FileText className="h-4 w-4 text-purple-500" />;
    case "media_removed":
      return <Trash2 className="h-4 w-4 text-red-500" />;
    case "scheduled":
      return <Clock className="h-4 w-4 text-orange-500" />;
    case "published":
      return <Eye className="h-4 w-4 text-green-500" />;
    case "archived":
      return <Trash2 className="h-4 w-4 text-gray-500" />;
    default:
      return <FileText className="h-4 w-4 text-gray-500" />;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionTimelineViewProps {
  /** Sorted, filtered list of versions to display. */
  versions: ContentVersion[];
  /** The `version` number considered "current" (highlights with ring-primary). */
  currentVersion: number;
  /** Whether compare mode is active (replaces View/Restore buttons with Select). */
  compareMode: boolean;
  /** The pair of versions currently selected for comparison. */
  compareVersions: { from: ContentVersion | null; to: ContentVersion | null };
  /** Whether to render media thumbnails below content snippets. */
  showMediaSupport: boolean;
  /** Whether to render the performance grid below each card. */
  showPerformanceData: boolean;
  /** Called when the user clicks "View" on a version. */
  onVersionSelect: (version: ContentVersion) => void;
  /** Called when the user clicks "Restore" on a non-current version. */
  onRestoreVersion: (version: ContentVersion) => void;
  /** Called when the user clicks the compare-select button in compare mode. */
  onCompareToggle: (version: ContentVersion) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionTimelineView({
  versions,
  currentVersion,
  compareMode,
  compareVersions,
  showMediaSupport,
  showPerformanceData,
  onVersionSelect,
  onRestoreVersion,
  onCompareToggle,
}: VersionTimelineViewProps) {
  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No versions found matching your criteria</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {versions.map((version, index) => {
        const isCurrentVersion = version.isCurrent || version.version === currentVersion;
        const textContent = getTextContent(version);
        const authorName = getAuthorName(version);
        const media = getVersionMedia(version);

        const isSelectedForCompare =
          compareVersions.from?.id === version.id || compareVersions.to?.id === version.id;

        return (
          <div key={version.id} className="relative">
            {index < versions.length - 1 && (
              <div className="absolute left-6 top-12 bottom-0 w-px bg-border" />
            )}
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-background border-2 border-border flex items-center justify-center">
                <ChangeTypeIcon changeType={version.changeType} />
              </div>
              <Card
                className={`flex-1 ${isCurrentVersion ? "ring-2 ring-primary" : ""} ${
                  compareMode ? "cursor-pointer hover:shadow-md" : ""
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">
                          Version {version.version}
                          {version.title && ` - ${version.title}`}
                        </h4>
                        {isCurrentVersion && (
                          <Badge variant="default" className="text-xs">
                            Current
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {getChangeTypeLabel(version.changeType)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {authorName}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(version.comment || version.changeDescription) && (
                    <div className="flex items-start gap-2 p-2 bg-muted rounded-sm text-sm">
                      <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <span>{version.comment ?? version.changeDescription}</span>
                    </div>
                  )}

                  <p className="text-sm line-clamp-3">{textContent}</p>

                  {showMediaSupport && media && media.length > 0 && (
                    <div className="flex gap-2">
                      {media.slice(0, 3).map((m) => (
                        <div key={m.id} className="w-16 h-16 border rounded-sm overflow-hidden">
                          {m.type === "image" ? (
                            <img src={m.url} alt={m.alt} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs">
                              Video
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {version.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {version.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{version.tags.length - 3}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {compareMode ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onCompareToggle(version)}
                          className={
                            isSelectedForCompare ? "bg-primary text-primary-foreground" : ""
                          }
                        >
                          <Diff className="h-4 w-4 mr-1" />
                          {isSelectedForCompare ? "Selected" : "Select"}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onVersionSelect(version)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          {!isCurrentVersion && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onRestoreVersion(version)}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Restore
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {showPerformanceData && version.performance && (
                    <div className="grid grid-cols-4 gap-2 p-3 bg-green-50 rounded-sm border mt-3">
                      <div className="text-center">
                        <div className="text-sm font-semibold text-green-700">
                          {version.performance.engagement.toLocaleString()}
                        </div>
                        <div className="text-xs text-green-600">Engagement</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold text-green-700">
                          {version.performance.reach.toLocaleString()}
                        </div>
                        <div className="text-xs text-green-600">Reach</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold text-green-700">
                          {version.performance.clicks.toLocaleString()}
                        </div>
                        <div className="text-xs text-green-600">Clicks</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold text-green-700">
                          {version.performance.shares.toLocaleString()}
                        </div>
                        <div className="text-xs text-green-600">Shares</div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        );
      })}
    </div>
  );
}
