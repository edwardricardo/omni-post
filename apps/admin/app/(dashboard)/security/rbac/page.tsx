/**
 * @file page.tsx
 * @description RBAC management page that renders the RbacManager component.
 *   Uses CSS design tokens and PageHeader.
 * @layer page
 */
"use client";

import RbacManager from "@/components/security/RbacManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default function RbacPage() {
  return (
    <div>
      <PageHeader
        title="Role-Based Access Control"
        description="Manage user roles, permissions, and access controls"
      />
      <RbacManager />
    </div>
  );
}
