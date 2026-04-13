/**
 * @file page.tsx
 * @component TemplateManagementPage
 * @description Template management page with library, A/B testing, and version control features.
 */

import { Suspense } from "react";
import { Metadata } from "next";
import { TemplateManagementDashboard } from "./TemplateManagementDashboard";

export const metadata: Metadata = {
  title: "Template Management - Social Media CMS",
  description:
    "Create, manage, and optimize your content templates with A/B testing and version control",
};

function TemplateManagementSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 bg-gray-200 rounded-sm w-64 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 bg-gray-200 rounded-sm animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Template Management</h1>
        <p className="text-gray-600 mt-2">
          Create, manage, and optimize your content templates with advanced features like A/B
          testing, version control, and performance analytics.
        </p>
      </div>

      <Suspense fallback={<TemplateManagementSkeleton />}>
        <TemplateManagementDashboard />
      </Suspense>
    </div>
  );
}
