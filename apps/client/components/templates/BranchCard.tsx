/**
 * @file BranchCard.tsx
 * @description Card component representing a version branch with metadata, author info, and merge/delete actions.
 */

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
import { GitBranch, GitCommit, GitMerge, Copy, Trash2, MoreVertical, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { VersionBranch } from "./templateVersionControlTypes";

interface BranchCardProps {
  branch: VersionBranch;
  allowBranching: boolean;
  onSwitchBranch: (branchName: string) => void;
  onMergeBranch: (sourceBranch: string, targetBranch: string) => void;
}

export function BranchCard({
  branch,
  allowBranching,
  onSwitchBranch,
  onMergeBranch,
}: BranchCardProps) {
  return (
    <Card className={branch.isMain ? "ring-2 ring-blue-500" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <GitBranch className="h-4 w-4" />
              <h3 className="text-sm font-medium">{branch.name}</h3>
              {branch.isMain && (
                <Badge variant="default" className="text-xs">
                  Main
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-1">{branch.description}</p>

            <div className="flex items-center space-x-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center space-x-1">
                <Avatar className="h-4 w-4">
                  <AvatarImage src={branch.author.avatar} />
                  <AvatarFallback className="text-xs">
                    {branch.author.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{branch.author.name}</span>
              </div>
              <div className="flex items-center space-x-1">
                <GitCommit className="h-3 w-3" />
                <span>{branch.versionCount} versions</span>
              </div>
              <div className="flex items-center space-x-1">
                <Clock className="h-3 w-3" />
                <span>{formatDistanceToNow(branch.createdAt, { addSuffix: true })}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 ml-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSwitchBranch(branch.name)}
              className="text-xs"
            >
              Switch
            </Button>
            {!branch.isMain && allowBranching && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onMergeBranch(branch.name, "main")}>
                    <GitMerge className="h-3 w-3 mr-1" />
                    Merge to Main
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy className="h-3 w-3 mr-1" />
                    Create from Branch
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600">
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete Branch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
