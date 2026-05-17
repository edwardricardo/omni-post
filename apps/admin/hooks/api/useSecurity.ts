/**
 * @file useSecurity.ts
 * @description TanStack Query hook that aggregates security overview data: security statistics,
 * MFA adoption rates, and the RBAC hierarchy from the backend security endpoints.
 */
import { useQuery } from "@tanstack/react-query";
import { api, SecurityStats, RbacHierarchy } from "../../lib/apiClient";

interface SecurityOverviewData {
  securityStats: SecurityStats;
  mfaOverview: {
    usersWithMfa: number;
    totalUsers: number;
    enablementRate: number;
  };
  rbacOverview: RbacHierarchy;
}

/**
 * @hook useSecurityOverview
 * @description Fetches aggregated security overview data combining security statistics,
 *   MFA adoption rates, and the RBAC hierarchy from backend security endpoints.
 * @returns Query result with { data: SecurityOverviewData, isLoading, error }
 */
export function useSecurityOverview() {
  return useQuery({
    queryKey: ["security", "overview"],
    queryFn: async (): Promise<SecurityOverviewData> => {
      const [securityResponse, rbacResponse] = await Promise.all([
        api.security.rbac.getStatus(),
        api.security.rbac.getHierarchy(),
      ]);
      if (!securityResponse.ok) {
        throw new Error("Failed to fetch security stats");
      }
      if (!rbacResponse.ok) {
        throw new Error("Failed to fetch RBAC data");
      }

      // Calculate MFA adoption stats
      const mfaOverview = {
        usersWithMfa: securityResponse.statistics.mfaEnabled || 0,
        totalUsers: securityResponse.statistics.totalUsers || 0,
        enablementRate: securityResponse.statistics.totalUsers
          ? ((securityResponse.statistics.mfaEnabled || 0) /
              securityResponse.statistics.totalUsers) *
            100
          : 0,
      };

      return {
        securityStats: securityResponse,
        mfaOverview,
        rbacOverview: rbacResponse,
      };
    },
    staleTime: 60000, // 1 minute
  });
}
