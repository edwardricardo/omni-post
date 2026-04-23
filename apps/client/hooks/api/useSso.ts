/**
 * @file useSso.ts
 * @description TanStack Query hooks for SAML and OIDC SSO configuration.
 * @layer infrastructure
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SamlConfig {
  id: string;
  accountId: string;
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  };
  isActive: boolean;
}

export interface OidcConfig {
  id: string;
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  attributeMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  };
  isActive: boolean;
}

export interface ConfigureSamlInput {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  };
}

export interface ConfigureOidcInput {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  attributeMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchSamlConfig(): Promise<SamlConfig | null> {
  const res = await fetch("/api/backend/saml/config", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; value?: SamlConfig };
  return data.ok && data.value ? data.value : null;
}

async function fetchOidcConfig(): Promise<OidcConfig | null> {
  const res = await fetch("/api/backend/oidc/config", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; value?: OidcConfig };
  return data.ok && data.value ? data.value : null;
}

async function configureSaml(input: ConfigureSamlInput): Promise<SamlConfig> {
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

async function configureOidc(input: ConfigureOidcInput): Promise<OidcConfig> {
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

async function enableSaml(): Promise<void> {
  const res = await fetch("/api/backend/saml/enable", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to enable SAML SSO");
}

async function enableOidc(): Promise<void> {
  const res = await fetch("/api/backend/oidc/enable", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to enable OIDC SSO");
}

async function disableSso(provider: "saml" | "oidc"): Promise<void> {
  const res = await fetch(`/api/backend/${provider}/disable`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to disable SSO");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useSamlConfig
 * @description Fetches the current SAML SSO configuration for the account.
 * @returns TanStack Query result with SAML config or null
 */
export function useSamlConfig() {
  return useQuery({
    queryKey: ["sso", "saml"],
    queryFn: fetchSamlConfig,
    staleTime: 60_000,
  });
}

/**
 * @hook useOidcConfig
 * @description Fetches the current OIDC SSO configuration for the account.
 * @returns TanStack Query result with OIDC config or null
 */
export function useOidcConfig() {
  return useQuery({
    queryKey: ["sso", "oidc"],
    queryFn: fetchOidcConfig,
    staleTime: 60_000,
  });
}

/**
 * @hook useConfigureSaml
 * @description Mutation hook for saving SAML SSO configuration.
 * @returns TanStack Query mutation that invalidates the SAML config on success
 */
export function useConfigureSaml() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: configureSaml,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso", "saml"] });
    },
  });
}

/**
 * @hook useConfigureOidc
 * @description Mutation hook for saving OIDC SSO configuration.
 * @returns TanStack Query mutation that invalidates the OIDC config on success
 */
export function useConfigureOidc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: configureOidc,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso", "oidc"] });
    },
  });
}

/**
 * @hook useEnableSaml
 * @description Mutation hook for enabling SAML SSO for the account.
 * @returns TanStack Query mutation that invalidates all SSO queries on success
 */
export function useEnableSaml() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enableSaml,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso"] });
    },
  });
}

/**
 * @hook useEnableOidc
 * @description Mutation hook for enabling OIDC SSO for the account.
 * @returns TanStack Query mutation that invalidates all SSO queries on success
 */
export function useEnableOidc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enableOidc,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso"] });
    },
  });
}

/**
 * @hook useDisableSso
 * @description Mutation hook for disabling SSO (SAML or OIDC) for the account.
 * @returns TanStack Query mutation that invalidates all SSO queries on success
 */
export function useDisableSso() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disableSso,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sso"] });
    },
  });
}
