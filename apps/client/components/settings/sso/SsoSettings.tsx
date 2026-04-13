/**
 * @file SsoSettings.tsx
 * @component SsoSettings
 * @description Main SSO settings component with SAML/OIDC tabs.
 * @layer client-components
 */

"use client";

import { useState } from "react";
import { useSamlConfig, useOidcConfig } from "@/hooks/api/useSso";
import { SsoStatusBanner } from "./SsoStatusBanner";
import { SamlConfigForm } from "./SamlConfigForm";
import { OidcConfigForm } from "./OidcConfigForm";

interface SsoSettingsProps {
  accountId: string;
}

type SsoTab = "saml" | "oidc";

export function SsoSettings({ accountId }: SsoSettingsProps) {
  const [activeTab, setActiveTab] = useState<SsoTab>("saml");
  const { data: samlConfig } = useSamlConfig();
  const { data: oidcConfig } = useOidcConfig();

  const activeProvider = samlConfig?.isActive ? "SAML" : oidcConfig?.isActive ? "OIDC" : "NONE";
  const isActive = activeProvider !== "NONE";

  return (
    <div className="space-y-6">
      <SsoStatusBanner provider={activeProvider} isActive={isActive} />

      {/* Tab Selector */}
      <div className="flex border-b">
        <button
          type="button"
          onClick={() => setActiveTab("saml")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "saml"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          SAML 2.0
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("oidc")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "oidc"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          OpenID Connect
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "saml" ? (
        <SamlConfigForm accountId={accountId} />
      ) : (
        <OidcConfigForm accountId={accountId} />
      )}
    </div>
  );
}
