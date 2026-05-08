/**
 * @file ActiveGatewayBanner.tsx
 * @description Banner shown to subscribers (State B). Surfaces the
 *              current processor and a "Switch payment processor" CTA
 *              that opens the confirmation dialog.
 * @component ActiveGatewayBanner
 * @layer infrastructure
 */

import { Button } from "@packages/ui";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { GATEWAY_LABELS } from "../utils/pricing";

interface ActiveGatewayBannerProps {
  currentGateway: GatewayProvider;
  onSwitchClick: () => void;
}

export function ActiveGatewayBanner({ currentGateway, onSwitchClick }: ActiveGatewayBannerProps) {
  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Active payment processor:{" "}
            <span className="font-semibold">{GATEWAY_LABELS[currentGateway]}</span>
          </h3>
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <p>Switching processors requires re-entering your card.</p>
            <p>Payment data cannot be transferred between processors.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onSwitchClick}>
          Switch payment processor
        </Button>
      </div>
    </div>
  );
}
