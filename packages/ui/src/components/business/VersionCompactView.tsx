/**
 * @file VersionCompactView.tsx
 * @description Compact "All Versions" list tab for ContentVersioning — dense row cards with
 *              inline diff expansion, checkbox bulk-select, and per-row actions.
 * @component VersionCompactView
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
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  Calendar,
  Hash,
} from "lucide-react";
import type { ContentVersion } from "./contentVersioningTypes";
import {
  getTextContent,
  getAuthorName,
  getChangeTypeLabel,
  getChangeTypeColor,
  formatVersionDate,
} from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Icon resolver (JSX version — kept local to avoid circular dep)
// ---------------------------------------------------------------------------

function ChangeTypeIcon({ changeType }: { changeType: ContentVersion["changeType"] }) {
  switch (changeType) {
    case "create":
    case "created":
      return <Plus className="w-4 h-4 text-green-500" />;
    case "edit":
    case "edited":
      return <Edit className="w-4 h-4 text-blue-500" />;
    case "branch":
      return <GitBranch className="w-4 h-4 text-purple-500" />;
    case "merge":
      return <ArrowRight className="w-4 h-4 text-orange-500" />;
    case "media_added":
      return <FileText className="w-4 h-4 text-purple-500" />;
    case "media_removed":
      return <Trash2 className="w-4 h-4 text-red-500" />;
    case "scheduled":
      return <Clock className="w-4 h-4 text-orange-500" />;
    case "published":
      return <Eye className="w-4 h-4 text-green-500" />;
    case "archived":
      return <Trash2 className="w-4 h-4 text-gray-500" />;
    default:
      return <FileText className="w-4 h-4 text-gray-500" />;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionCompactViewProps {
  /** Sorted, filtered list of versions to display. */
  versions: ContentVersion[];
  /** The `version` number considered "current". */
  currentVersion: number;
  /** IDs of versions currently checked via the checkbox. */
  selectedVersionIds: Set<string>;
  /** IDs of versions whose diff panel is expanded. */
  expandedVersionIds: Set<string>;
  /** Whether to show per-row checkboxes (requires showAdvancedFiltering). */
  showAdvancedFiltering: boolean;
  /** Whether to render per-version performance metrics. */
  showPerformanceData: boolean;
  /** Called when the user clicks the "View" eye button. */
  onVersionSelect: (version: ContentVersion) => void;
  /** Called when the user clicks the "Restore" button. */
  onRestoreVersion: (version: ContentVersion) => void;
  /** Called when the user clicks the download button. */
  onVersionDownload?: ((versionId: string, format: "json" | "txt" | "html") => void) | undefined;
  /** Called when the checkbox for a version is toggled. */
  onToggleSelection: (versionId: string) => void;
  /** Called when the expand/collapse chevron is clicked. */
  onToggleExpanded: (versionId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionCompactView({
  versions,
  currentVersion,
  selectedVersionIds,
  expandedVersionIds,
  showAdvancedFiltering,
  showPerformanceData,
  onVersionSelect,
  onRestoreVersion,
  onVersionDownload,
  onToggleSelection,
  onToggleExpanded,
}: VersionCompactViewProps) {
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
      {versions.map((version) => {
        const isCurrentVersion = version.isCurrent || version.version === currentVersion;
        const isSelected = selectedVersionIds.has(version.id);
        const isExpanded = expandedVersionIds.has(version.id);
        const textContent = getTextContent(version);
        const authorName = getAuthorName(version);

        return (
          <div
            key={version.id}
            className={`border rounded-lg transition-all duration-200 ${
              isSelected
                ? "border-blue-500 bg-blue-50"
                : isCurrentVersion
                  ? "border-green-500 bg-green-50"
                  : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3 flex-1">
                  {showAdvancedFiltering && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelection(version.id)}
                      className="mt-1 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  )}

                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <ChangeTypeIcon changeType={version.changeType} />
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">Version {version.version}</span>
                        {isCurrentVersion && (
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                            Current
                          </span>
                        )}
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${getChangeTypeColor(version.changeType)}`}
                        >
                          {getChangeTypeLabel(version.changeType)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
                      <div className="flex items-center space-x-1">
                        <User className="w-4 h-4" />
                        <span>{authorName}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Calendar className="w-4 h-4" />
                        <span>{formatVersionDate(version.createdAt)}</span>
                      </div>
                      {version.wordCount !== undefined && (
                        <div className="flex items-center space-x-1">
                          <Hash className="w-4 h-4" />
                          <span>{version.wordCount} words</span>
                        </div>
                      )}
                    </div>

                    {(version.comment || version.changeDescription) && (
                      <p className="text-sm text-gray-700 mb-3">
                        {version.comment ?? version.changeDescription}
                      </p>
                    )}

                    <div className="text-sm text-gray-900 mb-3 p-3 bg-gray-50 rounded-sm border">
                      {textContent.substring(0, 100)}
                      {textContent.length > 100 && "..."}
                    </div>

                    {version.tags && version.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {version.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-sm"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {showPerformanceData && version.performance && (
                      <div className="grid grid-cols-4 gap-4 p-3 bg-green-50 rounded-sm border mb-3">
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-700">
                            {version.performance.engagement.toLocaleString()}
                          </div>
                          <div className="text-xs text-green-600">Engagement</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-700">
                            {version.performance.reach.toLocaleString()}
                          </div>
                          <div className="text-xs text-green-600">Reach</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-700">
                            {version.performance.clicks.toLocaleString()}
                          </div>
                          <div className="text-xs text-green-600">Clicks</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-semibold text-green-700">
                            {version.performance.shares.toLocaleString()}
                          </div>
                          <div className="text-xs text-green-600">Shares</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 ml-4">
                  {version.diff && (
                    <button
                      onClick={() => onToggleExpanded(version.id)}
                      className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-sm"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  <div className="flex space-x-1">
                    <button
                      onClick={() => onVersionSelect(version)}
                      className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-sm"
                      title="View Version"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {!isCurrentVersion && (
                      <button
                        onClick={() => onRestoreVersion(version)}
                        className="p-2 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-sm"
                        title="Restore Version"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}

                    {onVersionDownload && (
                      <button
                        onClick={() => onVersionDownload(version.id, "json")}
                        className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-sm"
                        title="Download Version"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isExpanded && version.diff && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="font-medium text-gray-900 mb-3">Changes in this version:</h4>

                  {version.diff.additions.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-green-700 mb-1">Additions:</h5>
                      <ul className="text-sm space-y-1">
                        {version.diff.additions.map((addition, idx) => (
                          <li key={idx} className="text-green-600 bg-green-50 p-2 rounded-sm">
                            + {addition}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {version.diff.deletions.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-red-700 mb-1">Deletions:</h5>
                      <ul className="text-sm space-y-1">
                        {version.diff.deletions.map((deletion, idx) => (
                          <li key={idx} className="text-red-600 bg-red-50 p-2 rounded-sm">
                            - {deletion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {version.diff.modifications.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-blue-700 mb-1">Modifications:</h5>
                      <div className="text-sm space-y-2">
                        {version.diff.modifications.map((mod, idx) => (
                          <div key={idx} className="bg-blue-50 p-2 rounded-sm">
                            <div className="font-medium text-blue-800 mb-1">{mod.field}:</div>
                            <div className="text-red-600 mb-1">- {mod.oldValue}</div>
                            <div className="text-green-600">+ {mod.newValue}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
