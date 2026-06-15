/**
 * @file queries.ts
 * @description Read-only hooks for SSO configuration (SAML + OIDC).
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOidcConfig, fetchSamlConfig } from "./api";

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
