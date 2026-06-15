/**
 * @file mutations.ts
 * @description Mutation hooks for billing — initiate/cancel a gateway switch,
 *              start a checkout session, and open the gateway billing portal.
 *              Checkout/portal redirect to gateway URLs on success.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelGatewaySwitch,
  initiateGatewaySwitch,
  openBillingPortal,
  startCheckout,
} from "./api.js";
import type { GatewayProvider } from "./types.js";

/**
 * @hook useInitiateGatewaySwitch
 * @description Mutation hook for initiating a billing gateway switch (Stripe to Paddle or vice versa).
 * @returns TanStack Query mutation that invalidates gateway-status on success
 */
export function useInitiateGatewaySwitch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newProvider: GatewayProvider) => initiateGatewaySwitch(newProvider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gateway-status"] });
    },
  });
}

/**
 * @hook useCancelGatewaySwitch
 * @description Mutation hook for cancelling a pending billing gateway switch.
 * @returns TanStack Query mutation that invalidates gateway-status on success
 */
export function useCancelGatewaySwitch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelGatewaySwitch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gateway-status"] });
    },
  });
}

/**
 * @hook useCheckout
 * @description Mutation hook that creates a checkout session and redirects to the payment gateway.
 * @returns TanStack Query mutation that redirects to the checkout URL on success
 */
export function useCheckout() {
  return useMutation({
    mutationFn: startCheckout,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}

/**
 * @hook useBillingPortal
 * @description Mutation hook that redirects to the gateway billing portal for managing subscriptions and invoices.
 * @returns TanStack Query mutation that redirects to the portal URL on success
 */
export function useBillingPortal() {
  return useMutation({
    mutationFn: openBillingPortal,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}
