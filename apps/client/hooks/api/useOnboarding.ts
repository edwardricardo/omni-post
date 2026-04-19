/**
 * @file useOnboarding.ts
 * @description TanStack Query hooks for client onboarding progress tracking.
 * @layer infrastructure
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface OnboardingStep {
  key: string;
  completed: boolean;
  label: string;
}

interface OnboardingData {
  steps: OnboardingStep[];
  completedCount: number;
  totalSteps: number;
  completedAt: string | null;
  dismissedAt: string | null;
}

/**
 * @hook useOnboarding
 * @description Fetches onboarding progress for the current account.
 * @returns Query result with onboarding steps and completion status
 */
export function useOnboarding() {
  return useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch onboarding");
      const json = await res.json();
      return json.data as OnboardingData;
    },
    staleTime: 60_000,
  });
}

/**
 * @hook useCompleteStep
 * @description Mutation to mark an onboarding step as completed.
 * @returns Mutation object with mutate(stepKey)
 */
export function useCompleteStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepKey: string) => {
      const res = await fetch(`/api/onboarding/step/${stepKey}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to complete step");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}

/**
 * @hook useDismissOnboarding
 * @description Mutation to dismiss the onboarding checklist permanently.
 * @returns Mutation object with mutate()
 */
export function useDismissOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding/dismiss", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to dismiss onboarding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}
