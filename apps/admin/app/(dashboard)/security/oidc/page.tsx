/**
 * @file page.tsx
 * @description Admin form for replacing an OIDC client secret. Operator pastes
 *              the new secret from the IdP console (Google / Okta / etc.); the
 *              backend performs a discovery handshake against the IdP using
 *              that new secret. If discovery fails, the IdP error surfaces
 *              inline and no DB write happens. Audit-logged either way.
 * @component AdminOidcReplaceSecretPage
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useOidcReplaceClientSecret } from "@/hooks/api/useOidcReplaceClientSecret";
import { getErrorMessage } from "@packages/api-errors";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AdminOidcReplaceSecretPage() {
  const [accountId, setAccountId] = useState("");
  const [newClientSecret, setNewClientSecret] = useState("");
  const mutation = useOidcReplaceClientSecret();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId.trim() || !newClientSecret.trim()) return;
    mutation.mutate({
      accountId: accountId.trim(),
      newClientSecret: newClientSecret.trim(),
    });
  };

  return (
    <div>
      <PageHeader
        title="Replace OIDC client secret"
        description="Paste the new client secret issued by the IdP. Discovery is tested against the IdP before the new secret is persisted — invalid secrets surface the IdP error and never touch the database."
      />

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <div>
          <label
            htmlFor="accountId"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Account ID
          </label>
          <input
            id="accountId"
            type="text"
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="acct_..."
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <div>
          <label
            htmlFor="newClientSecret"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            New client secret (from IdP console)
          </label>
          <input
            id="newClientSecret"
            type="password"
            required
            value={newClientSecret}
            onChange={(e) => setNewClientSecret(e.target.value)}
            placeholder="paste here"
            autoComplete="off"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            The backend will run a discovery handshake against the IdP using this secret before
            persisting.
          </p>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending || !accountId.trim() || !newClientSecret.trim()}
          className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Validating + replacing…" : "Replace secret"}
        </button>
      </form>

      {mutation.isError && (
        <div
          className="mt-4 max-w-xl rounded-md border border-[var(--error)] bg-[var(--error-subtle)] p-3"
          role="alert"
        >
          <p className="font-medium text-[var(--error)]">
            Handshake or persistence failed — secret was not committed.
          </p>
          <p className="mt-1 text-sm text-[var(--error)]">{getErrorMessage(mutation.error)}</p>
        </div>
      )}

      {mutation.isSuccess && (
        <div
          className="mt-4 max-w-xl rounded-md border border-[var(--success)] bg-[var(--success-subtle)] p-3"
          role="status"
        >
          <p className="text-sm font-medium text-[var(--success)]">
            Replaced. New secret is now active for account{" "}
            <strong>{mutation.data.accountId}</strong>. Updated at{" "}
            {new Date(mutation.data.updatedAt).toLocaleString()}.
          </p>
        </div>
      )}
    </div>
  );
}
