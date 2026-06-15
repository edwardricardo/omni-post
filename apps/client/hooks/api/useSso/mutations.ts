/**
 * @file mutations.ts
 * @description Mutation hooks for SSO — configure/enable SAML, configure/enable
 *              OIDC, and disable either provider.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { configureOidc, configureSaml, disableSso, enableOidc, enableSaml } from "./api";

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
