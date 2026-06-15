/**
 * @file mutations.ts
 * @description Mutation hooks for compliance — update GDPR/security settings,
 *              acknowledge/complete/reject DSAR requests, create breach
 *              reports, send breach notifications. All mutations invalidate
 *              the `["compliance"]` query family.
 * @layer infrastructure
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeDsar,
  completeDsar,
  createBreachReport,
  rejectDsar,
  sendBreachNotification,
  updateGdprSettings,
  updateSecuritySettings,
} from "./api.js";

/**
 * @hook useUpdateGdprSettings
 * @description Mutation that updates GDPR configuration settings.
 *   Invalidates the compliance query family on success.
 * @returns Mutation object with mutate(Partial<GdprSettings>) and status fields
 */
export function useUpdateGdprSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateGdprSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useUpdateSecuritySettings
 * @description Mutation that updates security configuration settings.
 *   Invalidates the compliance query family on success.
 * @returns Mutation object with mutate(Partial<SecuritySettings>) and status fields
 */
export function useUpdateSecuritySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSecuritySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useAcknowledgeDsar
 * @description Mutation that acknowledges a DSAR request, transitioning it to IN_PROGRESS.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useAcknowledgeDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acknowledgeDsar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useCompleteDsar
 * @description Mutation that marks a DSAR request as completed, optionally attaching an export URL.
 * @returns Mutation object with mutate({ id, exportUrl? }) and status fields
 */
export function useCompleteDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completeDsar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useRejectDsar
 * @description Mutation that rejects a DSAR request with a reason.
 * @returns Mutation object with mutate({ id, reason }) and status fields
 */
export function useRejectDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rejectDsar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useCreateBreachReport
 * @description Mutation that creates a new breach report with severity, affected users, and data types.
 * @returns Mutation object with mutate(CreateBreachInput) and status fields
 */
export function useCreateBreachReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBreachReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

/**
 * @hook useSendBreachNotification
 * @description Mutation that sends breach notification emails for a given breach report.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useSendBreachNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendBreachNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}
