/**
 * @file SwitchConfirmDialog.tsx
 * @description Modal that confirms switching the active payment gateway.
 *              Used by `GatewaySection` State B — opens from the
 *              `ActiveGatewayBanner` "Switch" CTA, fires the parent's
 *              `onConfirm(targetGateway)` on submit.
 * @component SwitchConfirmDialog
 * @layer infrastructure
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@packages/ui";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { GATEWAY_LABELS, getAlternativeGateway } from "../utils/pricing";

interface SwitchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentGateway: GatewayProvider;
  onConfirm: (target: GatewayProvider) => void;
  isSubmitting: boolean;
}

export function SwitchConfirmDialog({
  open,
  onOpenChange,
  currentGateway,
  onConfirm,
  isSubmitting,
}: SwitchConfirmDialogProps) {
  const target = getAlternativeGateway(currentGateway);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch payment processor</DialogTitle>
          <DialogDescription>
            Change your billing from {GATEWAY_LABELS[currentGateway]} to {GATEWAY_LABELS[target]}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-foreground">
            <p>
              Currently using:{" "}
              <span className="font-semibold">{GATEWAY_LABELS[currentGateway]}</span>
            </p>
            <p className="mt-1">
              Switch to: <span className="font-semibold">{GATEWAY_LABELS[target]}</span>
            </p>
          </div>

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1.5">
            <p>The switch applies at the end of your current billing period.</p>
            <p>You must re-enter your card on {GATEWAY_LABELS[target]}.</p>
            <p>You&apos;ll have 48 hours to complete payment after the switch date.</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(target)} disabled={isSubmitting}>
            {isSubmitting ? "Confirming..." : "Confirm switch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
