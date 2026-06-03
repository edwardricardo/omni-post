/**
 * @file useABTests.ts
 * @description Custom hook for managing A/B tests on templates, including CRUD operations, lifecycle controls (start, pause, stop), and result fetching via TanStack Query.
 * @layer infrastructure
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { request, PROXY_BASE } from "@/lib/api/clients/request";

interface ABTest {
  id: string;
  name: string;
  description?: string;
  templateId: string;
  config: {
    enabled: boolean;
    variants: Array<{
      id: string;
      name: string;
      content: string;
      weight?: number;
    }>;
    trafficSplit?: number[];
    startDate?: Date;
    endDate?: Date;
  };
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  startDate?: Date;
  endDate?: Date;
  results?: {
    totalViews: number;
    totalConversions: number;
    overallConversionRate: number;
    variants: Array<{
      variantId: string;
      views: number;
      conversions: number;
      conversionRate: number;
      confidence: number;
      isWinner?: boolean;
      isStatisticallySignificant?: boolean;
    }>;
    winnerVariantId?: string;
    confidenceLevel: number;
    recommendedAction: "continue" | "stop" | "extend" | "implement_winner";
  };
  createdAt: Date;
  updatedAt: Date;
}

function makeAbTestsApi(projectId: string) {
  const base = `/projects/${projectId}/templates/ab-tests`;
  return {
    async getABTests(status?: ABTest["status"]): Promise<ABTest[]> {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      const qs = params.toString();
      const path = qs ? `${base}?${qs}` : base;
      const res = await request<{ data: ABTest[] }>(PROXY_BASE, path);
      return res.data;
    },
    async createABTest(
      test: Omit<ABTest, "id" | "status" | "createdAt" | "updatedAt">
    ): Promise<ABTest> {
      const res = await request<{ data: ABTest }>(PROXY_BASE, base, {
        method: "POST",
        body: JSON.stringify(test),
      });
      return res.data;
    },
    // The backend route for AB-test UPDATE is not currently exposed;
    // routing through the canonical client keeps the contract consistent.
    async updateABTest(test: ABTest): Promise<ABTest> {
      const res = await request<{ data: ABTest }>(PROXY_BASE, `${base}/${test.id}`, {
        method: "PUT",
        body: JSON.stringify(test),
      });
      return res.data;
    },
    async startABTest(testId: string): Promise<ABTest> {
      const res = await request<{ data: ABTest }>(PROXY_BASE, `${base}/${testId}/start`, {
        method: "POST",
      });
      return res.data;
    },
    // The backend route for AB-test PAUSE is not currently exposed.
    async pauseABTest(testId: string): Promise<ABTest> {
      const res = await request<{ data: ABTest }>(PROXY_BASE, `${base}/${testId}/pause`, {
        method: "POST",
      });
      return res.data;
    },
    async stopABTest(testId: string): Promise<ABTest> {
      const res = await request<{ data: ABTest }>(PROXY_BASE, `${base}/${testId}/stop`, {
        method: "POST",
      });
      return res.data;
    },
    // The backend route for AB-test DELETE is not currently exposed.
    async deleteABTest(testId: string): Promise<void> {
      await request<void>(PROXY_BASE, `${base}/${testId}`, {
        method: "DELETE",
      });
    },
    async getABTestResults(testId: string): Promise<ABTest["results"]> {
      const res = await request<{ data: ABTest["results"] }>(
        PROXY_BASE,
        `${base}/${testId}/results`
      );
      return res.data;
    },
  };
}

/**
 * @hook useABTests
 * @description Project-scoped A/B test management hook. List query plus six mutations
 *              (create / update / start / pause / stop / delete), all delegating to the
 *              canonical proxy `request<T>` helper.
 * @returns Query state plus six mutation handles.
 */
export function useABTests(projectId: string, status?: ABTest["status"]) {
  const queryClient = useQueryClient();
  const api = useMemo(() => makeAbTestsApi(projectId), [projectId]);

  const {
    data: tests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["ab-tests", projectId, status],
    queryFn: () => api.getABTests(status),
    staleTime: 2 * 60 * 1000,
  });

  const createTest = useMutation({
    mutationFn: api.createABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  const updateTest = useMutation({
    mutationFn: api.updateABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  const startTest = useMutation({
    mutationFn: api.startABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  const pauseTest = useMutation({
    mutationFn: api.pauseABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  const stopTest = useMutation({
    mutationFn: api.stopABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  const deleteTest = useMutation({
    mutationFn: api.deleteABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  return {
    tests,
    isLoading,
    error,
    refetch,
    createTest,
    updateTest,
    startTest,
    pauseTest,
    stopTest,
    deleteTest,
  };
}
