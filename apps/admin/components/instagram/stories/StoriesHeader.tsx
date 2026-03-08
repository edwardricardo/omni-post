/**
 * @file StoriesHeader.tsx
 * @description Header component for the Instagram Stories editor, displaying the project
 * name, story count, and action buttons for saving drafts and publishing the story set.
 */

import React from "react";
import { StoriesProject } from "./types";

interface StoriesHeaderProps {
  project: StoriesProject;
  isDisabled: boolean;
  onProjectNameChange: (name: string) => void;
  onSave: () => void;
  onSchedule: () => void;
  onPublish: () => void;
}

export function StoriesHeader({
  project,
  isDisabled,
  onProjectNameChange,
  onSave,
  onSchedule,
  onPublish,
}: StoriesHeaderProps) {
  return (
    <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <h1 className="text-2xl font-bold text-gray-900">Instagram Stories Editor</h1>
        <input
          type="text"
          value={project.name}
          onChange={(e) => onProjectNameChange(e.target.value)}
          className="px-3 py-2 border rounded-lg text-lg font-medium bg-transparent"
          placeholder="Project name"
        />
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            project.status === "draft"
              ? "bg-gray-100 text-gray-800"
              : project.status === "ready"
                ? "bg-blue-100 text-blue-800"
                : project.status === "scheduled"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-green-100 text-green-800"
          }`}
        >
          {project.status}
        </span>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onSave}
          disabled={isDisabled}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Save Draft
        </button>

        <button
          onClick={onSchedule}
          disabled={isDisabled}
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
        >
          Schedule
        </button>

        <button
          onClick={onPublish}
          disabled={isDisabled}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          Publish Now
        </button>
      </div>
    </div>
  );
}
