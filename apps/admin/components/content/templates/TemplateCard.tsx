"use client";

/**
 * @file TemplateCard.tsx
 * @description Card component representing a single content template, displaying its name,
 * description, category, usage stats, and action buttons for edit, copy, preview, and delete.
 */

import React from "react";
import { FileText, Play, Edit, Copy, Trash2, Star, Clock, Users, Wand2 } from "lucide-react";
import type { ContentTemplate } from "./types";

interface TemplateCardProps {
  template: ContentTemplate;
  onUse: (template: ContentTemplate) => void;
  onEdit: (templateId: string) => void;
  onDuplicate: (template: ContentTemplate) => void;
  onDelete: (templateId: string) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  onUse,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-white">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="font-medium text-gray-900">{template.name}</h3>
              {template.isFavorite && <Star className="w-4 h-4 text-yellow-500 fill-current" />}
            </div>
            <p className="text-sm text-gray-600 mb-2">{template.description}</p>
            <div className="flex items-center space-x-4 text-xs text-gray-500">
              <span className="flex items-center">
                <Users className="w-3 h-3 mr-1" />
                {template.metadata.usage.count} uses
              </span>
              <span className="flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {formatDate(template.metadata.updatedAt)}
              </span>
              {template.metadata.performance && (
                <span className="flex items-center">
                  <Star className="w-3 h-3 mr-1" />
                  {template.metadata.performance.avgEngagement} avg engagement
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex space-x-1">
          <button
            onClick={() => onUse(template)}
            className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-sm"
            title="Use Template"
          >
            <Play className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(template.id)}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-sm"
            title="Edit Template"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDuplicate(template)}
            className="p-2 text-green-600 hover:text-green-800 hover:bg-green-100 rounded-sm"
            title="Duplicate Template"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(template.id)}
            className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-sm"
            title="Delete Template"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {template.tags.map((tag, idx) => (
            <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-sm">
              {tag}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {template.platforms.map((platform, idx) => (
            <span
              key={idx}
              className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-sm capitalize"
            >
              {platform}
            </span>
          ))}
        </div>

        <div className="bg-gray-50 p-3 rounded-sm text-sm">
          <p className="text-gray-700 mb-2">Preview:</p>
          <div className="text-gray-600 italic">{template.content.text.substring(0, 120)}...</div>
        </div>

        {template.content.variables.length > 0 && (
          <div className="text-xs text-gray-500">
            Variables: {template.content.variables.map((v) => v.name).join(", ")}
          </div>
        )}

        {template.automationRules && template.automationRules.length > 0 && (
          <div className="flex items-center space-x-1 text-xs text-purple-600">
            <Wand2 className="w-3 h-3" />
            <span>
              {template.automationRules.length} automation rule
              {template.automationRules.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
