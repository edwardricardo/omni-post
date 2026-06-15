/**
 * @file GatewaySection.tsx
 * @description Top-of-page orchestrator that picks the right gateway UI
 *              for the user's current state: A) no subscription → local
 *              selector; B) active subscription → banner + confirm
 *              dialog; C) pending switch → status banner with cancel.
 * @component GatewaySection
 * @layer infrastructure
 */

import { useCallback, useState } from "react";
import {
  useCancelGatewaySwitch,
  useGatewayStatus,
  useInitiateGatewaySwitch,
} from "@/hooks/api/useBilling";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { ActiveGatewayBanner } from "./ActiveGatewayBanner";
import { GatewaySelector } from "./GatewaySelector";
import { PendingSwitchBanner } from "./PendingSwitchBanner";
import { SwitchConfirmDialog } from "./SwitchConfirmDialog";

export function GatewaySection() {
  const { data: gatewayStatus, isLoading, isError } = useGatewayStatus();
  const initiateSwitch = useInitiateGatewaySwitch();
  const cancelSwitch = useCancelGatewaySwitch();

  const [localGateway, setLocalGateway] = useState<GatewayProvider>("stripe");
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);

  const handleConfirmSwitch = useCallback(
    (target: GatewayProvider) => {
      initiateSwitch.mutate(target, {
        onSuccess: () => {
          setSwitchDialogOpen(false);
        },
      });
    },
    [initiateSwitch]
  );

  const handleCancelSwitch = useCallback(() => {
    cancelSwitch.mutate(undefined);
  }, [cancelSwitch]);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-5 mb-6 animate-pulse">
        <div className="h-4 bg-muted rounded w-48" />
        <div className="h-3 bg-muted rounded w-72 mt-2" />
      </div>
    );
  }

  if (isError || !gatewayStatus) {
    return <GatewaySelector selected={localGateway} onChange={setLocalGateway} />;
  }

  const { gatewayProvider, pendingSwitch } = gatewayStatus;

  if (
    pendingSwitch &&
    (pendingSwitch.status === "SCHEDULED" || pendingSwitch.status === "PENDING_CHECKOUT")
  ) {
    return (
      <PendingSwitchBanner
        status={pendingSwitch.status}
        toGateway={pendingSwitch.toGateway}
        scheduledFor={pendingSwitch.scheduledFor}
        extendedUntil={pendingSwitch.extendedUntil}
        onCancel={handleCancelSwitch}
        isCancelling={cancelSwitch.isPending}
      />
    );
  }

  return (
    <>
      <ActiveGatewayBanner
        currentGateway={gatewayProvider}
        onSwitchClick={() => setSwitchDialogOpen(true)}
      />
      <SwitchConfirmDialog
        open={switchDialogOpen}
        onOpenChange={setSwitchDialogOpen}
        currentGateway={gatewayProvider}
        onConfirm={handleConfirmSwitch}
        isSubmitting={initiateSwitch.isPending}
      />
    </>
  );
}
