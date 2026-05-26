/**
 * @file page.tsx
 * @description RBAC management page that renders the RbacManager component.
 *   Uses CSS design tokens and PageHeader.
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";

import RbacManager from "@/components/security/RbacManager";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * @component RbacPage
 * @description Manages role-based access control with role and permission configuration for admin users.
 */
export default function RbacPage() {
  const ts = useTranslations("security");

  return (
    <div>
      <PageHeader title={ts("rbac.title")} description={ts("rbac.description")} />
      <RbacManager />
    </div>
  );
}
