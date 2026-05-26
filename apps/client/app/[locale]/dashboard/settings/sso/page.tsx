/**
 * @file page.tsx
 * @component SsoSettingsPage
 * @description SSO settings page for SAML 2.0 and OpenID Connect configuration.
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth/authContext";
import { SsoSettings } from "@/components/settings/sso/SsoSettings";

export default function SsoSettingsPage() {
  const t = useTranslations("settings");
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("sso.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("sso.subtitle")}</p>
      </div>

      <SsoSettings accountId={accountId} />
    </div>
  );
}
