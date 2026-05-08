/**
 * @file PostCard.tsx
 * @description Renders a single post in the posts list. Two layouts:
 *              `compact` for the virtual-scroll variant (one-line tile),
 *              full Card for the grid / list variants. Status badge,
 *              tags, and the actions dropdown (Preview / Edit / Delete)
 *              live inline.
 * @component PostCard
 * @layer infrastructure
 */

import { format } from "date-fns";
import {
  BarChart3,
  Calendar,
  Edit,
  Eye,
  FileText,
  type LucideIcon,
  MoreVertical,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@packages/ui";
import type { Post } from "@/lib/api";

export const STATUS_COLORS = {
  DRAFT: "bg-gray-100 text-gray-800",
  SCHEDULED: "bg-blue-100 text-blue-800",
  PUBLISHED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
} as const;

export const STATUS_ICONS: Record<keyof typeof STATUS_COLORS, LucideIcon> = {
  DRAFT: FileText,
  SCHEDULED: Calendar,
  PUBLISHED: BarChart3,
  FAILED: Trash2,
};

function getPostPreview(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
}

interface PostCardProps {
  post: Post;
  onPreview: (postId: string) => void;
  onEdit: (postId: string) => void;
  onDelete: (postId: string) => void;
  isCompact?: boolean;
  className?: string;
  /**
   * When defined, renders a selection checkbox controlled by the parent.
   * Omit (or pass `undefined`) to render the card without selection UI.
   */
  isSelected?: boolean;
  onSelectChange?: (postId: string, next: boolean) => void;
}

function SelectionCheckbox({
  postId,
  isSelected,
  onSelectChange,
  className = "",
}: {
  postId: string;
  isSelected: boolean;
  onSelectChange: (postId: string, next: boolean) => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={`Select post ${postId}`}
      checked={isSelected}
      onChange={(e) => onSelectChange(postId, e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={`h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 ${className}`}
    />
  );
}

export function PostCard({
  post,
  onPreview,
  onEdit,
  onDelete,
  isCompact = false,
  className = "",
  isSelected,
  onSelectChange,
}: PostCardProps) {
  const StatusIcon = STATUS_ICONS[post.status as keyof typeof STATUS_ICONS];
  const statusClass = STATUS_COLORS[post.status as keyof typeof STATUS_COLORS];
  const showSelection = onSelectChange !== undefined && isSelected !== undefined;

  if (isCompact) {
    return (
      <div
        className={`flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors ${className}`}
      >
        {showSelection && (
          <SelectionCheckbox
            postId={post.id}
            isSelected={isSelected}
            onSelectChange={onSelectChange}
          />
        )}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm truncate">{post.title || "Untitled Post"}</h4>
            <Badge className={cn("text-xs ml-2", statusClass)}>
              <StatusIcon className="mr-1 h-3 w-3" />
              {post.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-1">
            {getPostPreview(post.body || "No content", 60)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {format(new Date(post.createdAt), "MMM d, yyyy")}
          </p>
        </div>
        <PostActionsMenu post={post} onPreview={onPreview} onEdit={onEdit} onDelete={onDelete} />
      </div>
    );
  }

  return (
    <Card className={`hover:shadow-md transition-shadow ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-1 items-start gap-3">
            {showSelection && (
              <SelectionCheckbox
                postId={post.id}
                isSelected={isSelected}
                onSelectChange={onSelectChange}
                className="mt-1"
              />
            )}
            <div className="flex-1">
              <CardTitle className="text-lg leading-6">{post.title || "Untitled Post"}</CardTitle>
              <CardDescription className="mt-1">
                {format(new Date(post.createdAt), "MMM d, yyyy")}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("text-xs", statusClass)}>
              <StatusIcon className="mr-1 h-3 w-3" />
              {post.status}
            </Badge>
            <PostActionsMenu
              post={post}
              onPreview={onPreview}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {getPostPreview(post.body || "No content")}
        </p>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {post.tags.slice(0, 3).map((tag: string, index: number) => (
              <Badge key={index} variant="secondary" className="text-xs">
                #{tag}
              </Badge>
            ))}
            {post.tags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{post.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PostActionsMenu({
  post,
  onPreview,
  onEdit,
  onDelete,
}: {
  post: Post;
  onPreview: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onPreview(post.id)}>
          <Eye className="mr-2 h-4 w-4" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(post.id)}>
          <Edit className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onDelete(post.id)} className="text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
