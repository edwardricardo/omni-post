/**
 * @file page.tsx
 * @component ReferralSettingsPage
 * @description Referral program settings page with share link and stats.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";
import { Copy, Check, Gift } from "lucide-react";

interface ReferralStats {
  code: string;
  shareUrl: string;
  usageCount: number;
  conversions: number;
}

export default function ReferralPage() {
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchReferral() {
      try {
        const res = await fetch(`/api/backend/referral/code?accountId=${accountId}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; value?: ReferralStats };
          if (data.ok && data.value) setStats(data.value);
        }
      } finally {
        setLoading(false);
      }
    }
    if (accountId) fetchReferral();
  }, [accountId]);

  const handleCopy = useCallback(() => {
    if (stats) {
      navigator.clipboard.writeText(stats.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [stats]);

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Referral Program</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Earn 30 days free for every customer you refer
        </p>
      </div>

      {stats && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium mb-3">Your referral link</h2>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-muted rounded px-3 py-2 border font-mono truncate">
                {stats.shareUrl}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-4 text-center">
              <p className="text-2xl font-bold">{stats.usageCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Signups</p>
            </div>
            <div className="rounded-lg border bg-card p-4 text-center">
              <p className="text-2xl font-bold">{stats.conversions}</p>
              <p className="text-xs text-muted-foreground mt-1">Conversions</p>
            </div>
            <div className="rounded-lg border bg-card p-4 text-center">
              <p className="text-2xl font-bold">{stats.conversions * 30}</p>
              <p className="text-xs text-muted-foreground mt-1">Free days earned</p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-5">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              How it works
            </h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                Share your unique referral link with others
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                They sign up and become a paying customer
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">3.</span>
                You get 30 free days added to your subscription per conversion
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
