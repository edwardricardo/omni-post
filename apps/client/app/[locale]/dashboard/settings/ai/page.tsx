/**
 * @file page.tsx
 * @component AiSettingsPage
 * @description AI settings page for managing BYOK API keys and viewing pool usage.
 *   Clients can configure their own OpenAI, Anthropic, Gemini, or Perplexity keys
 *   to bypass the shared AI pool.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Trash2, FlaskConical } from "lucide-react";
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@packages/ui";

import {
  useAiStatus,
  useSetByokKey,
  useDeleteByokKey,
  useTestByokKey,
} from "@/hooks/api/useAiSettings";
import type { AiProvider, ByokTestResult } from "@/hooks/api/useAiSettings";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDERS: { id: AiProvider; name: string; prefix?: string }[] = [
  { id: "openai", name: "OpenAI", prefix: "sk-" },
  { id: "anthropic", name: "Anthropic", prefix: "sk-ant-" },
  { id: "gemini", name: "Google Gemini" },
  { id: "perplexity", name: "Perplexity" },
];

// ---------------------------------------------------------------------------
// Pool Usage Meter
// ---------------------------------------------------------------------------

function PoolUsageMeter({
  used,
  budget,
  resetDate,
}: {
  used: number;
  budget: number;
  resetDate: string;
}) {
  const t = useTranslations("settings");
  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-orange-500" : "bg-primary";

  return (
    <div className="rounded-lg border bg-card p-4 mb-6">
      <h2 className="text-sm font-semibold mb-2">{t("ai.poolUsage")}</h2>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-muted-foreground">
          {t("ai.tokensUsage", { used: used.toLocaleString(), budget: budget.toLocaleString() })}
        </span>
        <span className="text-sm text-muted-foreground">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t("ai.resets", { date: new Date(resetDate).toLocaleDateString() })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  configured,
}: {
  provider: (typeof PROVIDERS)[number];
  configured: boolean;
}) {
  const t = useTranslations("settings");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<ByokTestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setMutation = useSetByokKey();
  const deleteMutation = useDeleteByokKey();
  const testMutation = useTestByokKey();

  const validate = useCallback(
    (key: string): string | null => {
      if (key.length < 10) return t("ai.errorKeyTooShort");
      if (provider.prefix && !key.startsWith(provider.prefix)) {
        return t("ai.errorKeyPrefix", { prefix: provider.prefix });
      }
      return null;
    },
    [provider.prefix, t]
  );

  const handleSave = useCallback(async () => {
    const err = validate(apiKey);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    try {
      await setMutation.mutateAsync({ provider: provider.id, apiKey });
      setApiKey("");
      setTestResult(null);
    } catch {
      setError(t("ai.errorSaveFailed"));
    }
  }, [apiKey, provider.id, setMutation, validate, t]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(provider.id);
      setConfirmDelete(false);
      setTestResult(null);
    } catch {
      setError(t("ai.errorRemoveFailed"));
    }
  }, [provider.id, deleteMutation, t]);

  const handleTest = useCallback(async () => {
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({
        provider: provider.id,
        apiKey: apiKey || "existing",
      });
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: t("ai.errorTestFailed") });
    }
  }, [provider.id, apiKey, testMutation, t]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{provider.name}</h3>
        <Badge variant={configured ? "default" : "secondary"}>
          {configured ? t("ai.statusConfigured") : t("ai.statusNotConfigured")}
        </Badge>
      </div>

      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setError("");
          }}
          placeholder={configured ? t("ai.placeholderUpdateKey") : t("ai.placeholderEnterKey")}
          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button size="sm" onClick={handleSave} disabled={!apiKey || setMutation.isPending}>
          {setMutation.isPending ? t("ai.saving") : t("ai.save")}
        </Button>
      </div>

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

      {configured && (
        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testMutation.isPending}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            {testMutation.isPending ? t("ai.testing") : t("ai.test")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {t("ai.remove")}
          </Button>
        </div>
      )}

      {testResult && (
        <div className="flex items-center gap-2 mt-2">
          <Badge variant={testResult.success ? "default" : "destructive"}>
            {testResult.success ? t("ai.connected") : t("ai.failed")}
          </Badge>
          <span className="text-xs text-muted-foreground">{testResult.message}</span>
          {testResult.latencyMs !== undefined && (
            <span className="text-xs text-muted-foreground">({testResult.latencyMs}ms)</span>
          )}
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai.removeDialogTitle", { provider: provider.name })}</DialogTitle>
            <DialogDescription>
              {t("ai.removeDialogDescription", { provider: provider.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("ai.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t("ai.removing") : t("ai.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiSettingsPage() {
  const t = useTranslations("settings");
  const { data: status, isLoading } = useAiStatus();

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">{t("ai.loading")}</div>;
  }

  if (!status) {
    return <div className="text-center py-8 text-muted-foreground">{t("ai.loadError")}</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("ai.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{t("ai.subtitle")}</p>
      </div>

      {!status.hasOwnKey && (
        <PoolUsageMeter
          used={status.usedThisMonth}
          budget={status.monthlyBudget}
          resetDate={status.resetDate}
        />
      )}

      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{t("ai.byokTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("ai.byokSubtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} configured={status.byokProvider === p.id} />
        ))}
      </div>
    </div>
  );
}
