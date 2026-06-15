/**
 * @file VersionCard.tsx
 * @component VersionCard
 * @description Card component representing a single template version with metadata, author info, and restore/delete actions.
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@packages/ui";
import {
  GitBranch,
  GitCommit,
  Eye,
  Download,
  Copy,
  Trash2,
  Tag,
  MoreVertical,
  RotateCcw,
  Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { TemplateVersion } from "./templateVersionControlTypes.js";

interface VersionCardProps {
  version: TemplateVersion;
  selectedVersions: string[];
  allowVersioning: boolean;
  onVersionSelect: (versionId: string, checked: boolean) => void;
  onRestore: (version: TemplateVersion) => void;
  onDelete: (version: TemplateVersion) => void;
}

export function VersionCard({
  version,
  selectedVersions,
  allowVersioning,
  onVersionSelect,
  onRestore,
  onDelete,
}: VersionCardProps) {
  const t = useTranslations("templates.components.versionControl");
  return (
    <Card className={`transition-colors ${version.isActive ? "ring-2 ring-blue-500" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={selectedVersions.includes(version.id)}
              onChange={(e) => onVersionSelect(version.id, e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <Badge variant={version.isActive ? "default" : "outline"}>v{version.version}</Badge>
                {version.isActive && (
                  <Badge variant="secondary" className="text-xs">
                    {t("activeBadge")}
                  </Badge>
                )}
                {version.branchName && version.branchName !== "main" && (
                  <Badge variant="outline" className="text-xs">
                    <GitBranch className="h-3 w-3 mr-1" />
                    {version.branchName}
                  </Badge>
                )}
              </div>

              <div className="mt-2">
                {version.commitMessage && (
                  <p className="text-sm font-medium">{version.commitMessage}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{version.changeLog}</p>
              </div>

              <div className="flex items-center space-x-4 mt-3 text-xs text-muted-foreground">
                <div className="flex items-center space-x-1">
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={version.author.avatar} />
                    <AvatarFallback className="text-xs">
                      {version.author.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span>{version.author.name}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Clock className="h-3 w-3" />
                  <span>{formatDistanceToNow(version.createdAt, { addSuffix: true })}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <GitCommit className="h-3 w-3" />
                  <span>{format(version.createdAt, "MMM dd, yyyy HH:mm")}</span>
                </div>
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("actions")}</DropdownMenuLabel>
              <DropdownMenuItem>
                <Eye className="h-3 w-3 mr-1" />
                {t("viewContent")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Copy className="h-3 w-3 mr-1" />
                {t("copyContent")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="h-3 w-3 mr-1" />
                {t("export")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {allowVersioning && !version.isActive && (
                <>
                  <DropdownMenuItem onClick={() => onRestore(version)}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {t("restore")}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Tag className="h-3 w-3 mr-1" />
                    {t("createTag")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onDelete(version)} className="text-red-600">
                    <Trash2 className="h-3 w-3 mr-1" />
                    {t("delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
