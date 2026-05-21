"use client";

/**
 * @file page.tsx
 * @description Repurpose opportunities page: lists the account's AI-detected
 *              high-performing posts proposed for cross-platform repurposing
 *              and lets the user trigger detection on demand.
 * @component RepurposePage
 * @layer infrastructure
 */

import { useCallback } from "react";
import { Button, Badge, Card, CardContent, toast } from "@packages/ui";
import { Sparkles } from "lucide-react";
import {
  useRepurposeProposals,
  useTriggerRepurposeDetect,
  type RepurposeProposal,
} from "@/hooks/api/useRepurpose";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

/**
 * @component RepurposePage
 * @description Shows repurpose proposals for the account with a manual
 *   "Detect now" trigger. Detection and listing are scoped server-side to
 *   the authenticated customer.
 */
export default function RepurposePage() {
  const { data, isLoading, error } = useRepurposeProposals();
  const detect = useTriggerRepurposeDetect();

  const handleDetect = useCallback(() => {
    detect.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Detection complete",
          description: `${result.detected} detected, ${result.alreadyProposed} already proposed`,
        });
      },
      onError: (err: unknown) => {
        toast({
          title: "Detection failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    });
  }, [detect]);

  const proposals: RepurposeProposal[] = data?.proposals ?? [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Repurpose Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-1">
            High-performing posts ready for cross-platform repurposing
          </p>
        </div>
        <Button onClick={handleDetect} disabled={detect.isPending} size="sm">
          <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />
          {detect.isPending ? "Detecting…" : "Detect now"}
        </Button>
      </div>

      {isLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">
          Loading…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive"
        >
          <p className="text-base font-semibold">Could not load proposals</p>
          <p className="mt-2 text-sm">
            {error instanceof Error ? error.message : "Please try again."}
          </p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No repurpose opportunities yet</p>
          <p className="text-sm mt-1">
            OmniPost monitors your posts and proposes repurposing when one performs exceptionally.
            Use “Detect now” to scan immediately.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <Card key={proposal.id}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{proposal.sourcePlatform}</span>
                    <Badge variant="secondary">{proposal.status}</Badge>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      {proposal.engagementMultiplier}× average
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {proposal.variantCount} variant{proposal.variantCount === 1 ? "" : "s"} ·{" "}
                    {formatDate(proposal.detectedAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
