/**
 * @file page.tsx
 * @description Content library page providing browsing, searching, and management capabilities
 * across all created posts for the active project via the ContentLibrary component.
 */
"use client";

import { ContentLibrary } from "@/components/content/ContentLibrary";
import { useProject } from "@/providers/ProjectProvider";

export default function ContentLibraryPage() {
  const { projectId, accountId } = useProject();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Content Library</h1>
        <p className="text-gray-600">Browse, search, and manage all your content in one place</p>
      </div>
      <ContentLibrary accountId={accountId} projectId={projectId} />
    </div>
  );
}
