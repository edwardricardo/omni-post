/**
 * @file useRepurpose.ts
 * @description TanStack Query hooks for the AI repurpose feature: list the
 *              account's proposals and trigger on-demand detection. Requests
 *              go through the /api/backend proxy, which injects the customer
 *              Bearer from the httpOnly session cookie; the account is scoped
 *              server-side from that token.
 * @layer infrastructure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface RepurposeProposal {
  id: string;
  sourcePostId: string;
  sourcePlatform: string;
  status: string;
  engagementRate: number;
  engagementMultiplier: number;
  detectedAt: string;
  reviewedAt: string | null;
  variantCount: number;
}

export interface RepurposeProposalsPage {
  proposals: RepurposeProposal[];
  total: number;
  limit: number;
  offset: number;
}

export interface RepurposeDetectResult {
  detected: number;
  alreadyProposed: number;
}

const PROPOSALS_KEY = ["repurpose-proposals"] as const;

async function parseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? fallback;
}

/**
 * @hook useRepurposeProposals
 * @description Fetches the first page of the account's repurpose proposals.
 * @returns TanStack Query result with the proposals page.
 */
export function useRepurposeProposals() {
  return useQuery({
    queryKey: PROPOSALS_KEY,
    queryFn: async (): Promise<RepurposeProposalsPage> => {
      const response = await fetch("/api/backend/repurpose/proposals", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to load proposals"));
      }
      const body = (await response.json()) as {
        ok: boolean;
        data?: RepurposeProposalsPage;
        error?: string;
      };
      if (!body.ok || !body.data) {
        throw new Error(body.error ?? "Failed to load proposals");
      }
      return body.data;
    },
  });
}

/**
 * @hook useTriggerRepurposeDetect
 * @description Mutation that runs repurpose detection on demand for the
 *   caller's account and refreshes the proposals list on success.
 * @returns TanStack Query mutation resolving to the detection counts.
 */
export function useTriggerRepurposeDetect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<RepurposeDetectResult> => {
      const response = await fetch("/api/backend/repurpose/detect", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Detection failed"));
      }
      const body = (await response.json()) as {
        ok: boolean;
        data?: RepurposeDetectResult;
        error?: string;
      };
      if (!body.ok || !body.data) {
        throw new Error(body.error ?? "Detection failed");
      }
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROPOSALS_KEY });
    },
  });
}
