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
import { useTranslations } from "next-intl";
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
  const t = useTranslations("ai");
  const { data, isLoading, error } = useRepurposeProposals();
  const detect = useTriggerRepurposeDetect();

  const handleDetect = useCallback(() => {
    detect.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: t("repurpose.detectSuccessTitle"),
          description: t("repurpose.detectSuccessDescription", {
            detected: result.detected,
            alreadyProposed: result.alreadyProposed,
          }),
        });
      },
      onError: (err: unknown) => {
        toast({
          title: t("repurpose.detectErrorTitle"),
          description: err instanceof Error ? err.message : t("repurpose.unknownError"),
          variant: "destructive",
        });
      },
    });
  }, [detect, t]);

  const proposals: RepurposeProposal[] = data?.proposals ?? [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("repurpose.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("repurpose.subtitle")}</p>
        </div>
        <Button onClick={handleDetect} disabled={detect.isPending} size="sm">
          <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />
          {detect.isPending ? t("repurpose.detecting") : t("repurpose.detectNow")}
        </Button>
      </div>

      {isLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">
          {t("repurpose.loading")}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive"
        >
          <p className="text-base font-semibold">{t("repurpose.loadErrorTitle")}</p>
          <p className="mt-2 text-sm">
            {error instanceof Error ? error.message : t("repurpose.tryAgain")}
          </p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">{t("repurpose.emptyTitle")}</p>
          <p className="text-sm mt-1">{t("repurpose.emptyDescription")}</p>
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
                      {t("repurpose.multiplier", { value: proposal.engagementMultiplier })}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("repurpose.variantCount", { count: proposal.variantCount })} ·{" "}
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
