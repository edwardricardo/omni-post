/**
 * @file page.tsx
 * @description Repurpose opportunities page showing AI-detected high-performing posts.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/authContext";
import { Button, toast } from "@packages/ui";

interface RepurposeProposal {
  id: string;
  sourcePlatform: string;
  engagementMultiplier: number;
  status: string;
  variants: Array<{
    id: string;
    platform: string;
    content: string;
    hashtags: string[];
    status: string;
  }>;
}

type ApprovalAction = "approve" | "reject";

async function parseRepurposeError(response: Response, fallback: string): Promise<string> {
  const err = (await response.json().catch(() => ({ message: fallback }))) as { message?: string };
  return err.message ?? fallback;
}

/**
 * @component RepurposePage
 * @description Shows AI-detected high-performing posts with cross-platform repurpose proposals and variant management.
 */
export default function RepurposePage() {
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const queryClient = useQueryClient();

  const {
    data: proposals = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repurpose-proposals", accountId],
    queryFn: async (): Promise<RepurposeProposal[]> => {
      const res = await fetch(`/api/backend/repurpose/proposals?accountId=${accountId}`, {
        credentials: "include",
      });
      if (res.status === 501) {
        // Pipeline scaffolded but not wired end-to-end (DETECT scheduler +
        // GENERATE worker + AI provider missing). Surface as a known state
        // so the page renders the "feature in development" banner instead
        // of a generic error toast. Tracked: PR-Repurpose-AI-Pipeline.
        throw new Error("PIPELINE_NOT_IMPLEMENTED");
      }
      if (!res.ok) {
        throw new Error(await parseRepurposeError(res, "Failed to load proposals"));
      }
      const data = (await res.json()) as { ok: boolean; value?: RepurposeProposal[] };
      if (!data.ok) return [];
      return data.value ?? [];
    },
    enabled: !!accountId,
    retry: false, // 501 is a permanent state — no point retrying
  });

  const isPipelineNotImplemented =
    error instanceof Error && error.message === "PIPELINE_NOT_IMPLEMENTED";

  const approvalMutation = useMutation({
    mutationFn: async ({ proposalId, action }: { proposalId: string; action: ApprovalAction }) => {
      const res = await fetch(`/api/backend/approvals/${proposalId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await parseRepurposeError(res, "Request failed"));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repurpose-proposals", accountId] });
    },
  });

  const handleApproval = useCallback(
    async (proposalId: string, action: ApprovalAction) => {
      try {
        await approvalMutation.mutateAsync({ proposalId, action });
        toast({
          title: action === "approve" ? "Proposal approved" : "Proposal rejected",
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        toast({
          title: `Failed to ${action} proposal`,
          description: msg,
          variant: "destructive",
        });
      }
    },
    [approvalMutation]
  );

  const pending = proposals.filter((p) => p.status === "PENDING");
  const pendingVariables = approvalMutation.variables;
  const pendingProposalId = approvalMutation.isPending ? pendingVariables?.proposalId : undefined;
  const pendingAction = approvalMutation.isPending ? pendingVariables?.action : undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Repurpose Opportunities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          High-performing posts ready for cross-platform repurposing
        </p>
      </div>

      {isPipelineNotImplemented ? (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900"
        >
          <p className="text-base font-semibold">Feature in development</p>
          <p className="mt-2 text-sm">
            The AI Repurpose pipeline is scaffolded — schema, use cases, adapters and this UI all
            exist — but the detection scheduler and variant-generation worker are not yet wired, and
            an AI provider (OpenAI / Perplexity / Gemini) credential is required. Tracked as{" "}
            <code className="font-mono text-xs">PR-Repurpose-AI-Pipeline</code> in the
            post-remediation backlog.
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : pending.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No repurpose opportunities yet</p>
          <p className="text-sm mt-1">
            OmniPost monitors your posts and will suggest repurposing when one performs
            exceptionally.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((proposal) => (
            <div key={proposal.id} className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{proposal.sourcePlatform}</span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    {proposal.engagementMultiplier}x average
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {proposal.variants.length} variants ready
                </span>
              </div>
              <div className="space-y-2">
                {proposal.variants
                  .filter((v) => v.status === "PENDING")
                  .map((variant) => {
                    const isThisPending = pendingProposalId === proposal.id;
                    return (
                      <div key={variant.id} className="rounded border p-3 bg-muted/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{variant.platform}</span>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isThisPending}
                              onClick={() => handleApproval(proposal.id, "approve")}
                            >
                              {isThisPending && pendingAction === "approve"
                                ? "Approving..."
                                : "Approve"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isThisPending}
                              onClick={() => handleApproval(proposal.id, "reject")}
                            >
                              {isThisPending && pendingAction === "reject"
                                ? "Rejecting..."
                                : "Reject"}
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {variant.content}
                        </p>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
