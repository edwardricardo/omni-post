/**
 * @file mutations.ts
 * @description Mutation hooks for gateway-switch admin actions — extend
 *              deadline, force-complete, force-suspend. Each one shows a
 *              toast and invalidates the gateway-switches cache on success.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { getErrorMessage } from "@/lib/parseApiError";
import { extendSwitchDeadline, forceCompleteSwitch, forceSuspendSwitch } from "./api";

const KEY = ["gateway-switches"] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY });
}

function errorToast(err: unknown) {
  toast({ title: "Error", description: getErrorMessage(err), variant: "destructive" });
}

/**
 * @hook useExtendSwitchDeadline
 * @description Mutation that extends the checkout deadline for a gateway switch event.
 * @returns Mutation object with mutate({ id, extraHours }) and status fields
 */
export function useExtendSwitchDeadline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: extendSwitchDeadline,
    onSuccess: () => {
      invalidate(qc);
      toast({ title: "Success", description: "Deadline extended successfully" });
    },
    onError: errorToast,
  });
}

/**
 * @hook useForceCompleteSwitch
 * @description Mutation that forces a gateway switch event to complete.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useForceCompleteSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: forceCompleteSwitch,
    onSuccess: () => {
      invalidate(qc);
      toast({ title: "Success", description: "Switch forced to complete" });
    },
    onError: errorToast,
  });
}

/**
 * @hook useForceSuspendSwitch
 * @description Mutation that forces a gateway switch event to suspend.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useForceSuspendSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: forceSuspendSwitch,
    onSuccess: () => {
      invalidate(qc);
      toast({ title: "Success", description: "Account suspended" });
    },
    onError: errorToast,
  });
}
