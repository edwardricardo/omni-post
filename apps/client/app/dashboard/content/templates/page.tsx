/**
 * @file page.tsx
 * @description Content templates management page rendering the ContentTemplates component
 * with automation features enabled for the active project. Server Component —
 * ContentTemplates child is the Client Component boundary.
 * @layer infrastructure
 */

import ContentTemplates from "@/components/content/ContentTemplates";

/**
 * @component TemplatesPage
 * @description Displays content templates management with automation features enabled for the active project.
 */
export default function TemplatesPage() {
  return (
    <div className="p-6">
      <ContentTemplates showAutomation={true} />
    </div>
  );
}
