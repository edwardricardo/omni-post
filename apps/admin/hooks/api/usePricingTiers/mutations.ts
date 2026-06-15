/**
 * @file mutations.ts
 * @description Mutation hooks for pricing tiers — create/update provider
 *              tiers, account tiers, and bundles, plus tier status toggle and
 *              bundle deletion. All invalidate the pricing cache on success.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAccountTier,
  createBundle,
  createProviderTier,
  deleteBundle,
  toggleTierStatus,
  updateAccountTier,
  updateBundle,
  updateProviderTier,
} from "./api.js";

const PRICING_KEY = ["pricing", "tiers"] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: PRICING_KEY });
}

/**
 * @hook useUpdateProviderTier
 * @description Mutation that updates a provider tier by ID. Invalidates pricing cache on success.
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateProviderTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProviderTier,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useUpdateAccountTier
 * @description Mutation that updates an account tier by ID. Invalidates pricing cache on success.
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateAccountTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAccountTier,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useUpdateBundle
 * @description Mutation that updates a pricing bundle by ID. Invalidates pricing cache on success.
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateBundle,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useCreateBundle
 * @description Mutation that creates a new pricing bundle. Invalidates pricing cache on success.
 * @returns Mutation object with mutate(CreateBundleInput) and status fields
 */
export function useCreateBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBundle,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useCreateProviderTier
 * @description Mutation that creates a new provider tier. Invalidates pricing cache on success.
 * @returns Mutation object with mutate(CreateProviderTierInput) and status fields
 */
export function useCreateProviderTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProviderTier,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useCreateAccountTier
 * @description Mutation that creates a new account tier. Invalidates pricing cache on success.
 * @returns Mutation object with mutate(CreateAccountTierInput) and status fields
 */
export function useCreateAccountTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAccountTier,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useToggleTierStatus
 * @description Mutation that toggles the active status of a provider or account tier.
 *   Invalidates pricing cache on success.
 * @returns Mutation object with mutate({ type, id, isActive }) and status fields
 */
export function useToggleTierStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleTierStatus,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useDeleteBundle
 * @description Mutation that deletes a pricing bundle by ID. Invalidates pricing cache on success.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useDeleteBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteBundle,
    onSuccess: () => invalidate(qc),
  });
}
