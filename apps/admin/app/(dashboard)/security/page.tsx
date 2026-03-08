/**
 * @file page.tsx
 * @description Security overview page displaying security stats, MFA adoption rate, and RBAC
 * hierarchy summary fetched from the backend via the useSecurityOverview hook.
 */
"use client";

import { useSecurityOverview } from "@/hooks/api/useSecurity";

function SecurityPageContent() {
  const { data, isLoading, error } = useSecurityOverview();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded-sm mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow-sm border">
                <div className="h-4 bg-gray-200 rounded-sm mb-2"></div>
                <div className="h-8 bg-gray-200 rounded-sm"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading Security Dashboard</h3>
          <p className="text-red-600 mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">No security data available</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
        <p className="text-gray-600">Monitor and manage system security settings</p>
      </div>

      {/* Security Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-sm font-medium text-gray-500 uppercase">Security Status</h3>
          <div className="mt-2">
            <span
              className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                data.securityStats.status === "healthy"
                  ? "bg-green-100 text-green-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {data.securityStats.status.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-sm font-medium text-gray-500 uppercase">MFA Adoption</h3>
          <div className="mt-2 flex items-baseline">
            <span className="text-2xl font-bold text-gray-900">
              {(data.mfaOverview.enablementRate * 100).toFixed(0)}%
            </span>
            <span className="ml-2 text-sm text-gray-600">
              ({data.mfaOverview.usersWithMfa}/{data.mfaOverview.totalUsers} users)
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-sm font-medium text-gray-500 uppercase">Active Roles</h3>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {data.securityStats.statistics.totalRoles}
          </div>
          <div className="text-sm text-gray-600">
            {data.securityStats.statistics.totalPermissions} permissions
          </div>
        </div>
      </div>

      {/* Role Distribution */}
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Role Distribution</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.securityStats.statistics.roleDistribution.map((role) => (
            <div key={role.role} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{role.role}</span>
                <span className="text-sm text-gray-600">{role.percentage.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${role.percentage}%` }}
                ></div>
              </div>
              <div className="text-sm text-gray-600 mt-1">{role.userCount} users</div>
            </div>
          ))}
        </div>
      </div>

      {/* RBAC Hierarchy Overview */}
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Permission Hierarchy</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Role Levels</h3>
            <div className="space-y-2">
              {Object.entries(data.rbacOverview.hierarchy)
                .sort(([, a], [, b]) => b.level - a.level)
                .map(([role, info]) => (
                  <div
                    key={role}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded-sm"
                  >
                    <span className="font-medium">{info.name}</span>
                    <span className="text-sm text-gray-600">Level {info.level}</span>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Permission Categories</h3>
            <div className="space-y-2">
              {Object.entries(data.rbacOverview.permissionCategories).map(([category, perms]) => (
                <div
                  key={category}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded-sm"
                >
                  <span className="font-medium">{category}</span>
                  <span className="text-sm text-gray-600">{perms.length} permissions</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-blue-500 hover:bg-blue-50 transition-colors">
            <div className="text-sm font-medium text-gray-700">Manage User Roles</div>
            <div className="text-xs text-gray-500 mt-1">View and modify user permissions</div>
          </button>

          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-green-500 hover:bg-green-50 transition-colors">
            <div className="text-sm font-medium text-gray-700">MFA Settings</div>
            <div className="text-xs text-gray-500 mt-1">Configure multi-factor authentication</div>
          </button>

          <button className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-purple-500 hover:bg-purple-50 transition-colors">
            <div className="text-sm font-medium text-gray-700">Security Audit</div>
            <div className="text-xs text-gray-500 mt-1">Review security logs and events</div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <SecurityPageContent />;
}
