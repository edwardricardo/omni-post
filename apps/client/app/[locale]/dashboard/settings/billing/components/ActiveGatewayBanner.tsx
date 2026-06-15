/**
 * @file ActiveGatewayBanner.tsx
 * @description Banner shown to subscribers (State B). Surfaces the
 *              current processor and a "Switch payment processor" CTA
 *              that opens the confirmation dialog.
 * @component ActiveGatewayBanner
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { GATEWAY_LABELS } from "../utils/pricing.js";

interface ActiveGatewayBannerProps {
  currentGateway: GatewayProvider;
  onSwitchClick: () => void;
}

export function ActiveGatewayBanner({ currentGateway, onSwitchClick }: ActiveGatewayBannerProps) {
  const t = useTranslations("settings");
  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {t("billing.components.activeBanner.title")}{" "}
            <span className="font-semibold">{GATEWAY_LABELS[currentGateway]}</span>
          </h3>
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <p>{t("billing.components.activeBanner.noteReenterCard")}</p>
            <p>{t("billing.components.activeBanner.noteNoTransfer")}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onSwitchClick}>
          {t("billing.components.activeBanner.switchButton")}
        </Button>
      </div>
    </div>
  );
}
