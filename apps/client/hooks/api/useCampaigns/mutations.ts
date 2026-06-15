/**
 * @file mutations.ts
 * @description Mutation hooks for campaigns — create and archive.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { archiveCampaign, createCampaign } from "./api.js";

/**
 * @hook useCreateCampaign
 * @description Mutation hook for creating a new campaign.
 * @returns TanStack Query mutation that invalidates the campaigns list on success
 */
export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

/**
 * @hook useArchiveCampaign
 * @description Mutation hook for archiving a campaign.
 * @returns TanStack Query mutation that invalidates the campaigns list on success
 */
export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}
