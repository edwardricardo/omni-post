/**
 * @file SsoStatusBanner.tsx
 * @component SsoStatusBanner
 * @description Shows current SSO status with enable/disable controls.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { Shield, ShieldAlert } from "lucide-react";
import { useDisableSso } from "@/hooks/api/useSso";

interface SsoStatusBannerProps {
  provider: "NONE" | "SAML" | "OIDC";
  isActive: boolean;
}

export function SsoStatusBanner({ provider, isActive }: SsoStatusBannerProps) {
  const t = useTranslations("settings.components");
  const [showConfirm, setShowConfirm] = useState(false);
  const disableMutation = useDisableSso();

  const handleDisable = useCallback(() => {
    const target = provider === "SAML" ? "saml" : "oidc";
    disableMutation.mutate(target as "saml" | "oidc", {
      onSuccess: () => setShowConfirm(false),
    });
  }, [provider, disableMutation]);

  if (!isActive || provider === "NONE") {
    return (
      <div className="rounded-lg border bg-muted/50 p-4 flex items-center gap-3">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="font-medium text-muted-foreground">{t("ssoBanner.notConfigured")}</p>
          <p className="text-sm text-muted-foreground">{t("ssoBanner.notConfiguredHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-800">{t("ssoBanner.active", { provider })}</p>
            <p className="text-sm text-green-700">{t("ssoBanner.activeHint")}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-red-600 border-red-200 hover:bg-red-50"
        >
          {t("ssoBanner.disable")}
        </Button>
      </div>

      {showConfirm && (
        <div role="alert" className="mt-4 p-3 rounded-md bg-red-50 border border-red-200">
          <div className="flex items-start gap-2">
            <ShieldAlert aria-hidden="true" className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">{t("ssoBanner.confirmTitle")}</p>
              <p className="text-sm text-red-700 mt-1">{t("ssoBanner.confirmBody")}</p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDisable}
                  disabled={disableMutation.isPending}
                >
                  {disableMutation.isPending
                    ? t("ssoBanner.disabling")
                    : t("ssoBanner.confirmDisable")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>
                  {t("ssoBanner.cancel")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
