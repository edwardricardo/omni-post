/**
 * @file page.tsx
 * @description Repurpose opportunities page showing AI-detected high-performing posts.
 * @layer client-pages
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";

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

export default function RepurposePage() {
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const [proposals, setProposals] = useState<RepurposeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, "approve" | "reject" | null>>(
    {}
  );

  const fetchProposals = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/repurpose/proposals?accountId=${accountId}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; value?: RepurposeProposal[] };
        if (data.ok && data.value) setProposals(data.value);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const handleApproval = useCallback(
    async (proposalId: string, action: "approve" | "reject") => {
      setActionLoading((prev) => ({ ...prev, [proposalId]: action }));
      try {
        const res = await fetch(`/api/backend/approvals/${proposalId}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ message: "Request failed" }));
          throw new Error((errData as { message?: string }).message ?? "Request failed");
        }
        await fetchProposals();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        alert(`Failed to ${action} proposal: ${msg}`);
      } finally {
        setActionLoading((prev) => ({ ...prev, [proposalId]: null }));
      }
    },
    [fetchProposals]
  );

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const pending = proposals.filter((p) => p.status === "PENDING");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Repurpose Opportunities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          High-performing posts ready for cross-platform repurposing
        </p>
      </div>

      {loading ? (
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
                  .map((variant) => (
                    <div key={variant.id} className="rounded border p-3 bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{variant.platform}</span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading[proposal.id] != null}
                            onClick={() => handleApproval(proposal.id, "approve")}
                          >
                            {actionLoading[proposal.id] === "approve" ? "Approving..." : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={actionLoading[proposal.id] != null}
                            onClick={() => handleApproval(proposal.id, "reject")}
                          >
                            {actionLoading[proposal.id] === "reject" ? "Rejecting..." : "Reject"}
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {variant.content}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
