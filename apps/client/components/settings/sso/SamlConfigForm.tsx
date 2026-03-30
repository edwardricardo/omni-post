/**
 * @file SamlConfigForm.tsx
 * @description SAML 2.0 configuration form with SP metadata display.
 * @layer client-components
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Label } from "@packages/ui";
import { Copy, Check } from "lucide-react";
import { useSamlConfig, useConfigureSaml, useEnableSaml } from "@/hooks/api/useSso";

interface SamlConfigFormProps {
  accountId: string;
}

export function SamlConfigForm({ accountId }: SamlConfigFormProps) {
  const { data: config } = useSamlConfig();
  const configureMutation = useConfigureSaml();
  const enableMutation = useEnableSaml();

  const [idpEntityId, setIdpEntityId] = useState(config?.idpEntityId ?? "");
  const [idpSsoUrl, setIdpSsoUrl] = useState(config?.idpSsoUrl ?? "");
  const [idpCertificate, setIdpCertificate] = useState(config?.idpCertificate ?? "");
  const [emailAttr, setEmailAttr] = useState(config?.attributeMapping?.email ?? "email");
  const [firstNameAttr, setFirstNameAttr] = useState(config?.attributeMapping?.firstName ?? "");
  const [lastNameAttr, setLastNameAttr] = useState(config?.attributeMapping?.lastName ?? "");
  const [saved, setSaved] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const spEntityId = `https://omnipost.app/saml/${accountId}`;
  const acsUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/saml/${accountId}/callback`;

  const canSave =
    idpEntityId.trim().length > 0 &&
    idpSsoUrl.startsWith("https://") &&
    idpCertificate.trim().length > 0 &&
    emailAttr.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    await configureMutation.mutateAsync({
      idpEntityId: idpEntityId.trim(),
      idpSsoUrl: idpSsoUrl.trim(),
      idpCertificate: idpCertificate.trim(),
      attributeMapping: {
        email: emailAttr.trim(),
        ...(firstNameAttr.trim() ? { firstName: firstNameAttr.trim() } : {}),
        ...(lastNameAttr.trim() ? { lastName: lastNameAttr.trim() } : {}),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }, [
    canSave,
    idpEntityId,
    idpSsoUrl,
    idpCertificate,
    emailAttr,
    firstNameAttr,
    lastNameAttr,
    configureMutation,
  ]);

  const handleEnable = useCallback(async () => {
    await enableMutation.mutateAsync();
  }, [enableMutation]);

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  return (
    <div className="space-y-6">
      {/* SP Metadata (read-only) */}
      <div className="rounded-lg border p-4 bg-muted/30">
        <h3 className="text-sm font-medium mb-3">Service Provider Information</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Copy these values to your Identity Provider configuration.
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">SP Entity ID</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 text-sm bg-background rounded px-2 py-1 border font-mono truncate">
                {spEntityId}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(spEntityId, "entityId")}
              >
                {copiedField === "entityId" ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-xs">ACS URL (Callback)</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 text-sm bg-background rounded px-2 py-1 border font-mono truncate">
                {acsUrl}
              </code>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(acsUrl, "acsUrl")}>
                {copiedField === "acsUrl" ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* IdP Configuration */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Identity Provider Configuration</h3>

        <div>
          <Label htmlFor="saml-entity-id">IdP Entity ID *</Label>
          <Input
            id="saml-entity-id"
            value={idpEntityId}
            onChange={(e) => setIdpEntityId(e.target.value)}
            placeholder="https://idp.example.com/saml2"
          />
        </div>

        <div>
          <Label htmlFor="saml-sso-url">IdP SSO URL *</Label>
          <Input
            id="saml-sso-url"
            type="url"
            value={idpSsoUrl}
            onChange={(e) => setIdpSsoUrl(e.target.value)}
            placeholder="https://idp.example.com/saml2/sso"
          />
          {idpSsoUrl && !idpSsoUrl.startsWith("https://") && (
            <p className="text-xs text-red-600 mt-1">Must use HTTPS</p>
          )}
        </div>

        <div>
          <Label htmlFor="saml-cert">IdP Certificate (PEM) *</Label>
          <textarea
            id="saml-cert"
            value={idpCertificate}
            onChange={(e) => setIdpCertificate(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
            rows={6}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono resize-none"
          />
        </div>
      </div>

      {/* Attribute Mapping */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Attribute Mapping</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="saml-email-attr">Email *</Label>
            <Input
              id="saml-email-attr"
              value={emailAttr}
              onChange={(e) => setEmailAttr(e.target.value)}
              placeholder="email"
            />
          </div>
          <div>
            <Label htmlFor="saml-fn-attr">First Name</Label>
            <Input
              id="saml-fn-attr"
              value={firstNameAttr}
              onChange={(e) => setFirstNameAttr(e.target.value)}
              placeholder="firstName"
            />
          </div>
          <div>
            <Label htmlFor="saml-ln-attr">Last Name</Label>
            <Input
              id="saml-ln-attr"
              value={lastNameAttr}
              onChange={(e) => setLastNameAttr(e.target.value)}
              placeholder="lastName"
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
            {enableMutation.isPending ? "Enabling..." : "Enable SAML SSO"}
          </Button>
        )}
      </div>
    </div>
  );
}
