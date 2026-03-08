/**
 * @file page.tsx
 * @description RBAC management page that renders the RbacManager component for viewing
 * and updating role-based access control settings for admin users.
 */
"use client";

import RbacManager from "@/components/security/RbacManager";

export default function RbacPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Role-Based Access Control</h1>
        <p className="text-gray-600">Manage user roles, permissions, and access controls</p>
      </div>

      <RbacManager />
    </div>
  );
}
