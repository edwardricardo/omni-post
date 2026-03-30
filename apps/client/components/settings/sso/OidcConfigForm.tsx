/**
 * @file OidcConfigForm.tsx
 * @description OpenID Connect configuration form with redirect URI display.
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { Copy, Check } from "lucide-react";
import { useOidcConfig, useConfigureOidc, useEnableOidc } from "@/hooks/api/useSso";

interface OidcConfigFormProps {
  accountId: string;
}

export function OidcConfigForm({ accountId }: OidcConfigFormProps) {
  const { data: config } = useOidcConfig();
  const configureMutation = useConfigureOidc();
  const enableMutation = useEnableOidc();

  const [issuerUrl, setIssuerUrl] = useState(config?.issuerUrl ?? "");
  const [clientId, setClientId] = useState(config?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(config?.scopes?.join(", ") ?? "openid, email, profile");
  const [emailAttr, setEmailAttr] = useState(config?.attributeMapping?.email ?? "email");
  const [nameAttr, setNameAttr] = useState(config?.attributeMapping?.firstName ?? "name");
  const [saved, setSaved] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const redirectUri = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/oidc/${accountId}/callback`;

  const canSave =
    issuerUrl.startsWith("https://") &&
    clientId.trim().length > 0 &&
    clientSecret.trim().length > 0 &&
    emailAttr.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const scopeArray = scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await configureMutation.mutateAsync({
      issuerUrl: issuerUrl.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      ...(scopeArray.length > 0 ? { scopes: scopeArray } : {}),
      attributeMapping: {
        email: emailAttr.trim(),
        ...(nameAttr.trim() ? { firstName: nameAttr.trim() } : {}),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [canSave, issuerUrl, clientId, clientSecret, scopes, emailAttr, nameAttr, configureMutation]);

  const handleEnable = useCallback(async () => {
    await enableMutation.mutateAsync();
  }, [enableMutation]);

  const copyRedirect = useCallback(() => {
    navigator.clipboard.writeText(redirectUri);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2000);
  }, [redirectUri]);

  return (
    <div className="space-y-6">
      {/* Redirect URI (read-only) */}
      <div className="rounded-lg border p-4 bg-muted/30">
        <h3 className="text-sm font-medium mb-2">Redirect URI</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Add this URI to your OIDC provider&apos;s allowed redirect URIs.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm bg-background rounded px-2 py-1 border font-mono truncate">
            {redirectUri}
          </code>
          <Button variant="ghost" size="sm" onClick={copyRedirect}>
            {copiedRedirect ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Provider Configuration */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Provider Configuration</h3>

        <div>
          <Label htmlFor="oidc-issuer">Issuer URL *</Label>
          <Input
            id="oidc-issuer"
            type="url"
            value={issuerUrl}
            onChange={(e) => setIssuerUrl(e.target.value)}
            placeholder="https://accounts.google.com"
          />
          {issuerUrl && !issuerUrl.startsWith("https://") && (
            <p className="text-xs text-red-600 mt-1">Must use HTTPS</p>
          )}
        </div>

        <div>
          <Label htmlFor="oidc-client-id">Client ID *</Label>
          <Input
            id="oidc-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="your-client-id"
          />
        </div>

        <div>
          <Label htmlFor="oidc-client-secret">Client Secret *</Label>
          <Input
            id="oidc-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="your-client-secret"
          />
        </div>

        <div>
          <Label htmlFor="oidc-scopes">Scopes</Label>
          <Input
            id="oidc-scopes"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            placeholder="openid, email, profile"
          />
          <p className="text-xs text-muted-foreground mt-1">Comma-separated list</p>
        </div>
      </div>

      {/* Attribute Mapping */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Claim Mapping</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="oidc-email">Email Claim *</Label>
            <Input
              id="oidc-email"
              value={emailAttr}
              onChange={(e) => setEmailAttr(e.target.value)}
              placeholder="email"
            />
          </div>
          <div>
            <Label htmlFor="oidc-name">Name Claim</Label>
            <Input
              id="oidc-name"
              value={nameAttr}
              onChange={(e) => setNameAttr(e.target.value)}
              placeholder="name"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={!canSave || configureMutation.isPending}>
          {configureMutation.isPending ? "Saving..." : saved ? "Saved!" : "Save Configuration"}
        </Button>
        {config && !config.isActive && (
          <Button variant="outline" onClick={handleEnable} disabled={enableMutation.isPending}>
            {enableMutation.isPending ? "Enabling..." : "Enable OIDC SSO"}
          </Button>
        )}
      </div>
    </div>
  );
}
