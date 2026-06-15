/**
 * @file page.tsx
 * @description Brand-listening dashboard route. Resolves the active project from
 *   context and renders the listening dashboard (mentions, sentiment, Share of
 *   Voice), fetched through the authenticated Next.js proxy.
 * @layer infrastructure
 */
"use client";

import { useProject } from "@/providers/ProjectProvider";
import { ListeningDashboard } from "./components/ListeningDashboard.js";

/**
 * @component ListeningPage
 * @description Listening dashboard page; scopes the dashboard to the active project.
 */
export default function ListeningPage() {
  const { projectId } = useProject();
  return <ListeningDashboard projectId={projectId} />;
}
