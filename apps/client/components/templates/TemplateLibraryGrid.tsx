"use client";

/**
 * @file TemplateLibraryGrid.tsx
 * @description Template card and list item rendering for the TemplateLibrary, supporting
 * both grid and virtual-scroll list view modes.
 */

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { VirtualScrollList } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@packages/ui";
import {
  Search,
  Plus,
  Edit,
  Copy,
  Trash2,
  MoreVertical,
  Eye,
  Heart,
  MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import type { Template } from "@/lib/templates/templateEngine";
import type { TemplateLibraryGridProps } from "./templateLibraryTypes";

function TemplateCard({
  template,
  isFavorite,
  stats,
  showAnalytics,
  allowEdit,
  allowDelete,
  actions,
}: {
  template: Template;
  isFavorite: boolean;
  stats: { views: number; uses: number; likes: number };
  showAnalytics: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  actions: TemplateLibraryGridProps["actions"];
}) {
  return (
    <div className="p-2 h-full">
      <Card className="group hover:shadow-lg transition-shadow duration-200 h-full flex flex-col">
        <CardHeader className="pb-2 shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm truncate">{template.name}</CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                {template.description}
              </CardDescription>
            </div>
            <div className="flex items-center space-x-1 ml-2 shrink-0">
              {actions.onToggleFavorite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.onToggleFavorite?.(template)}
                  className="h-6 w-6 p-0"
                >
                  <Heart className={`h-3 w-3 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => actions.onPreview(template)}>
                    <Eye className="h-3 w-3 mr-1" />
                    Preview
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => actions.onUse(template)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Use Template
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => actions.onCopy(template)}>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy Content
                  </DropdownMenuItem>
                  {actions.onDuplicate && (
                    <DropdownMenuItem onClick={() => actions.onDuplicate?.(template)}>
                      <Copy className="h-3 w-3 mr-1" />
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {allowEdit && actions.onEdit && (
                    <DropdownMenuItem onClick={() => actions.onEdit?.(template)}>
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {allowDelete && actions.onDelete && (
                    <DropdownMenuItem
                      onClick={() => actions.onDelete?.(template)}
                      className="text-red-600"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 flex-1 flex flex-col">
          {/* Category and platforms */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              {template.category}
            </Badge>
            <div className="flex space-x-1">
              {template.platforms.slice(0, 2).map((platform) => (
                <Badge key={platform} variant="secondary" className="text-xs">
                  {platform.toUpperCase()}
                </Badge>
              ))}
              {template.platforms.length > 2 && (
                <Badge variant="secondary" className="text-xs">
                  +{template.platforms.length - 2}
                </Badge>
              )}
            </div>
          </div>

          {/* Variables and analytics */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {template.variables.length > 0 && (
              <span>
                {template.variables.length} var{template.variables.length !== 1 ? "s" : ""}
              </span>
            )}
            {showAnalytics && (
              <div className="flex items-center space-x-2">
                <span className="flex items-center">
                  <Eye className="h-3 w-3 mr-1" />
                  {stats.views}
                </span>
                <span className="flex items-center">
                  <MessageSquare className="h-3 w-3 mr-1" />
                  {stats.uses}
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {template.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  #{tag}
                </Badge>
              ))}
              {template.tags.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{template.tags.length - 2}
                </Badge>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-2 mt-auto">
            <Button size="sm" onClick={() => actions.onUse(template)} className="flex-1 text-xs">
              Use
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => actions.onPreview(template)}
              className="text-xs"
            >
              <Eye className="h-3 w-3" />
            </Button>
          </div>

          {/* Date info */}
          {template.updatedAt && (
            <div className="text-xs text-muted-foreground">
              {format(new Date(template.updatedAt), "MMM dd")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateListItem({
  template,
  isFavorite,
  stats,
  showAnalytics,
  actions,
}: {
  template: Template;
  isFavorite: boolean;
  stats: { views: number; uses: number; likes: number };
  showAnalytics: boolean;
  actions: TemplateLibraryGridProps["actions"];
}) {
  return (
    <div className="p-1 h-full">
      <Card className="p-3 hover:shadow-md transition-shadow duration-200 h-full">
        <div className="flex items-center justify-between h-full">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium truncate">{template.name}</h3>
                <p className="text-xs text-muted-foreground truncate">{template.description}</p>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <Badge variant="outline" className="text-xs">
                  {template.category}
                </Badge>
                <div className="flex space-x-1">
                  {template.platforms.slice(0, 2).map((platform) => (
                    <Badge key={platform} variant="secondary" className="text-xs">
                      {platform.toUpperCase()}
                    </Badge>
                  ))}
                  {template.platforms.length > 2 && (
                    <Badge variant="secondary" className="text-xs">
                      +{template.platforms.length - 2}
                    </Badge>
                  )}
                </div>
              </div>
              {showAnalytics && (
                <div className="flex items-center space-x-3 text-xs text-muted-foreground shrink-0">
                  <span>{stats.uses} uses</span>
                  <span>{stats.views} views</span>
                </div>
              )}
              <div className="flex items-center space-x-1 shrink-0">
                <Button size="sm" onClick={() => actions.onUse(template)} className="text-xs">
                  Use
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => actions.onPreview(template)}
                  className="text-xs"
                >
                  <Eye className="h-3 w-3" />
                </Button>
                {actions.onToggleFavorite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => actions.onToggleFavorite?.(template)}
                    className="h-6 w-6 p-0"
                  >
                    <Heart className={`h-3 w-3 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function TemplateLibraryGrid({
  templates,
  viewMode,
  favorites,
  analytics,
  showAnalytics,
  allowEdit,
  allowDelete,
  actions,
}: TemplateLibraryGridProps) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2" />
            <p>No templates found matching your criteria.</p>
            <p className="text-sm">Try adjusting your search or filters.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="border rounded-lg" style={{ height: "600px", overflow: "auto" }}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 p-2">
          {templates.map((template) => (
            <div key={template.id} style={{ minHeight: "300px" }}>
              <TemplateCard
                template={template}
                isFavorite={favorites.includes(template.id)}
                stats={analytics[template.id] || { views: 0, uses: 0, likes: 0 }}
                showAnalytics={showAnalytics}
                allowEdit={allowEdit}
                allowDelete={allowDelete}
                actions={actions}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <VirtualScrollList
      items={templates}
      height={500}
      itemHeight={80}
      overscan={5}
      className="border rounded-lg"
      renderItem={(template) => (
        <TemplateListItem
          template={template}
          isFavorite={favorites.includes(template.id)}
          stats={analytics[template.id] || { views: 0, uses: 0, likes: 0 }}
          showAnalytics={showAnalytics}
          actions={actions}
        />
      )}
    />
  );
}
