/**
 * @file page.tsx
 * @description Admin form for cross-tenant mass force-reauth on a Provider
 *              after a platform-level OAuth client_secret rotation. Operator
 *              picks the provider, types a reason, toggles tiered actions
 *              (flag channels DEFAULT-ON, soft-delete channels DESTRUCTIVE-OFF).
 *              Soft-delete requires typed confirmation. Audit-logged with
 *              aggregated counts.
 * @component AdminProviderMassReauthPage
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useProviderForceMassReauth } from "@/hooks/api/useProviderForceMassReauth";
import { getErrorMessage } from "@packages/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";

const PROVIDERS = [
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
  "PINTEREST",
  "SNAPCHAT",
] as const;

export default function AdminProviderMassReauthPage() {
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("FACEBOOK");
  const [reason, setReason] = useState("");
  const [flagChannels, setFlagChannels] = useState(true);
  const [softDeleteChannels, setSoftDeleteChannels] = useState(false);
  const [softDeleteConfirm, setSoftDeleteConfirm] = useState("");
  const mutation = useProviderForceMassReauth();

  const softDeleteRequired = `DELETE ${provider}`;
  const softDeleteUnlocked = !softDeleteChannels || softDeleteConfirm.trim() === softDeleteRequired;
  const anyTier = flagChannels || softDeleteChannels;
  const canSubmit = !mutation.isPending && !!reason.trim() && anyTier && softDeleteUnlocked;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({
      provider,
      reason: reason.trim(),
      flagChannels,
      softDeleteChannels,
    });
  };

  return (
    <div>
      <PageHeader
        title="Mass force-reauth (post platform secret rotation)"
        description="Cross-tenant action triggered after a Provider OAuth client_secret rotation. Choose tiers — flag is canonical (banner), disable connections is medium-aggressive, soft-delete is destructive (tenants reconnect from scratch). Audit-logged."
      />

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <div>
          <label
            htmlFor="provider"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Provider
          </label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="reason"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Reason
          </label>
          <input
            id="reason"
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. FACEBOOK_CLIENT_SECRET rotated 2026-05-06"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <fieldset className="space-y-2 rounded-md border border-[var(--border-subtle)] p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            Action tiers
          </legend>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={flagChannels}
              onChange={(e) => setFlagChannels(e.target.checked)}
              disabled={mutation.isPending}
              className="mt-1"
            />
            <span className="text-sm text-[var(--text-primary)]">
              <strong>Flag channels</strong> (default) — set Channel.needsReauth=true. Tenant sees
              reconnect banner; refresh fails on next cycle.
            </span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={softDeleteChannels}
              onChange={(e) => setSoftDeleteChannels(e.target.checked)}
              disabled={mutation.isPending}
              className="mt-1"
            />
            <span className="text-sm text-[var(--text-primary)]">
              <strong>Soft-delete channels</strong> (destructive) — set Channel.deletedAt=now().
              Tenants reconnect from scratch. Irreversible without DB restore.
            </span>
          </label>

          {softDeleteChannels && (
            <div className="ml-6 mt-2">
              <label
                htmlFor="softDeleteConfirm"
                className="mb-1 block text-xs font-medium text-[var(--error)]"
              >
                Type <code>{softDeleteRequired}</code> to confirm soft-delete
              </label>
              <input
                id="softDeleteConfirm"
                type="text"
                value={softDeleteConfirm}
                onChange={(e) => setSoftDeleteConfirm(e.target.value)}
                disabled={mutation.isPending}
                className="w-full rounded-md border border-[var(--error)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
              />
            </div>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Executing…" : "Execute mass force-reauth"}
        </button>
      </form>

      {mutation.isError && (
        <div
          className="mt-4 max-w-xl rounded-md border border-[var(--error)] bg-[var(--error-subtle)] p-3"
          role="alert"
        >
          <p className="text-sm text-[var(--error)]">{getErrorMessage(mutation.error)}</p>
        </div>
      )}

      {mutation.isSuccess && (
        <div
          className="mt-4 max-w-xl space-y-2 rounded-md border border-[var(--success)] bg-[var(--success-subtle)] p-3"
          role="status"
        >
          <p className="text-sm font-medium text-[var(--success)]">
            Mass force-reauth executed for <strong>{mutation.data.provider}</strong>.
          </p>
          <ul className="text-sm text-[var(--text-primary)]">
            <li>
              Channels flagged: <strong>{mutation.data.channelsFlagged}</strong>
            </li>
            <li>
              Channels soft-deleted: <strong>{mutation.data.channelsSoftDeleted}</strong>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
