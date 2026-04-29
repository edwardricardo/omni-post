/**
 * @file api.ts
 * @description Internal fetch helpers for SSO configuration endpoints.
 * @layer infrastructure
 */

import type {
  ConfigureOidcInput,
  ConfigureSamlInput,
  OidcConfig,
  SamlConfig,
  SsoProvider,
} from "./types";

export async function fetchSamlConfig(): Promise<SamlConfig | null> {
  const res = await fetch("/api/backend/saml/config", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; value?: SamlConfig };
  return data.ok && data.value ? data.value : null;
}

export async function fetchOidcConfig(): Promise<OidcConfig | null> {
  const res = await fetch("/api/backend/oidc/config", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; value?: OidcConfig };
  return data.ok && data.value ? data.value : null;
}

export async function configureSaml(input: ConfigureSamlInput): Promise<SamlConfig> {
  const res = await fetch("/api/backend/saml/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to configure SAML");
  const data = (await res.json()) as { ok: boolean; value?: SamlConfig };
  if (!data.ok || !data.value) throw new Error("SAML configuration failed");
  return data.value;
}

export async function configureOidc(input: ConfigureOidcInput): Promise<OidcConfig> {
  const res = await fetch("/api/backend/oidc/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to configure OIDC");
  const data = (await res.json()) as { ok: boolean; value?: OidcConfig };
  if (!data.ok || !data.value) throw new Error("OIDC configuration failed");
  return data.value;
}

export async function enableSaml(): Promise<void> {
  const res = await fetch("/api/backend/saml/enable", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to enable SAML SSO");
}

export async function enableOidc(): Promise<void> {
  const res = await fetch("/api/backend/oidc/enable", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to enable OIDC SSO");
}

export async function disableSso(provider: SsoProvider): Promise<void> {
  const res = await fetch(`/api/backend/${provider}/disable`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to disable SSO");
}
