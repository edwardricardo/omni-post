/**
 * @file page.tsx
 * @description Content templates management page rendering the ContentTemplates component
 * with automation features enabled for the active project.
 */
"use client";

import ContentTemplates from "@/components/content/ContentTemplates";

export default function TemplatesPage() {
  return (
    <div className="p-6">
      <ContentTemplates showAutomation={true} />
    </div>
  );
}
