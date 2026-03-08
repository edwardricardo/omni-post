/**
 * @file page.tsx
 * @description MFA settings page that renders the MfaManager component for enabling,
 * disabling, and verifying Multi-Factor Authentication for admin accounts.
 */
"use client";

import MfaManager from "@/components/security/MfaManager";

export default function MfaPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Multi-Factor Authentication</h1>
        <p className="text-gray-600">Manage MFA settings for admin users and system security</p>
      </div>

      <MfaManager />
    </div>
  );
}
