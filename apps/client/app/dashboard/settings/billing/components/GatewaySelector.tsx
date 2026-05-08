/**
 * @file GatewaySelector.tsx
 * @description Radio-button card that lets a user without an active
 *              subscription choose between Stripe and Paddle before
 *              checkout. Used in State A of `GatewaySection`.
 * @component GatewaySelector
 * @layer infrastructure
 */

import type { GatewayProvider } from "@/hooks/api/useBilling";

interface GatewaySelectorProps {
  selected: GatewayProvider;
  onChange: (gateway: GatewayProvider) => void;
}

export function GatewaySelector({ selected, onChange }: GatewaySelectorProps) {
  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <h3 className="text-sm font-medium text-foreground mb-3">Procesador de pago</h3>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <input
            id="gateway-stripe"
            type="radio"
            name="gateway"
            value="stripe"
            checked={selected === "stripe"}
            onChange={() => onChange("stripe")}
            className="mt-1"
          />
          <label htmlFor="gateway-stripe" className="cursor-pointer">
            <span className="text-sm font-medium text-foreground">Stripe</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recommended for US, Canada and Europe.
            </p>
            <p className="text-xs text-muted-foreground">
              Visa, Mastercard, Amex, Apple Pay, Google Pay.
            </p>
          </label>
        </div>
        <div className="flex items-start gap-3">
          <input
            id="gateway-paddle"
            type="radio"
            name="gateway"
            value="paddle"
            checked={selected === "paddle"}
            onChange={() => onChange("paddle")}
            className="mt-1"
          />
          <label htmlFor="gateway-paddle" className="cursor-pointer">
            <span className="text-sm font-medium text-foreground">Paddle</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recommended for rest of the world.
            </p>
            <p className="text-xs text-muted-foreground">
              VAT and local tax handling included. Visa, Mastercard, PayPal and more.
            </p>
          </label>
        </div>
      </div>
    </div>
  );
}
