/**
 * @file useABTests.ts
 * @description Custom hook for managing A/B tests on templates, including CRUD operations, lifecycle controls (start, pause, stop), and result fetching via TanStack Query.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

// API client functions
const abTestsApi = {
  async getABTests(projectId: string, status?: ABTest["status"]): Promise<ABTest[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);

    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests?${params}`);
    if (!response.ok) {
      throw new Error("Failed to fetch A/B tests");
    }
    const data = await response.json();
    return data.data;
  },

  async createABTest(
    projectId: string,
    test: Omit<ABTest, "id" | "status" | "createdAt" | "updatedAt">
  ): Promise<ABTest> {
    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(test),
    });

    if (!response.ok) {
      throw new Error("Failed to create A/B test");
    }
    const data = await response.json();
    return data.data;
  },

  async updateABTest(test: ABTest): Promise<ABTest> {
    const response = await fetch(`/api/ab-tests/${test.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(test),
    });

    if (!response.ok) {
      throw new Error("Failed to update A/B test");
    }
    const data = await response.json();
    return data.data;
  },

  async startABTest(projectId: string, testId: string): Promise<ABTest> {
    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests/${testId}/start`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to start A/B test");
    }
    const data = await response.json();
    return data.data;
  },

  async pauseABTest(projectId: string, testId: string): Promise<ABTest> {
    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests/${testId}/pause`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to pause A/B test");
    }
    const data = await response.json();
    return data.data;
  },

  async stopABTest(projectId: string, testId: string): Promise<ABTest> {
    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests/${testId}/stop`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to stop A/B test");
    }
    const data = await response.json();
    return data.data;
  },

  async deleteABTest(testId: string): Promise<void> {
    const response = await fetch(`/api/ab-tests/${testId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete A/B test");
    }
  },

  async getABTestResults(projectId: string, testId: string): Promise<ABTest["results"]> {
    const response = await fetch(`/api/projects/${projectId}/templates/ab-tests/${testId}/results`);
    if (!response.ok) {
      throw new Error("Failed to fetch A/B test results");
    }
    const data = await response.json();
    return data.data;
  },
};

export function useABTests(projectId: string, status?: ABTest["status"]) {
  const queryClient = useQueryClient();

  // Query for fetching A/B tests
  const {
    data: tests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["ab-tests", projectId, status],
    queryFn: () => abTestsApi.getABTests(projectId, status),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Mutation for creating A/B tests
  const createTest = useMutation({
    mutationFn: (test: Omit<ABTest, "id" | "status" | "createdAt" | "updatedAt">) =>
      abTestsApi.createABTest(projectId, test),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  // Mutation for updating A/B tests
  const updateTest = useMutation({
    mutationFn: abTestsApi.updateABTest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  // Mutation for starting A/B tests
  const startTest = useMutation({
    mutationFn: (testId: string) => abTestsApi.startABTest(projectId, testId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  // Mutation for pausing A/B tests
  const pauseTest = useMutation({
    mutationFn: (testId: string) => abTestsApi.pauseABTest(projectId, testId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  // Mutation for stopping A/B tests
  const stopTest = useMutation({
    mutationFn: (testId: string) => abTestsApi.stopABTest(projectId, testId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests", projectId] });
    },
  });

  // Mutation for deleting A/B tests
  const deleteTest = useMutation({
    mutationFn: abTestsApi.deleteABTest,
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
