"use client";

/**
 * @file RbacManager.tsx
 * @description Admin RBAC management panel for viewing roles and permissions, listing users
 * per role, and updating individual user role assignments across the platform.
 */

import { useState, useEffect, useCallback } from "react";
import { api, RoleInfo } from "../../lib/apiClient";

interface RbacUser {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLogin: string | null;
  isActive: boolean;
}

export default function RbacManager() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleUsers, setRoleUsers] = useState<RbacUser[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      const response = await api.security.rbac.getRoles();
      if (!response.ok) {
        throw new Error("Failed to fetch roles");
      }

      setRoles(response.roles);
      setPermissionCategories(response.permissionCategories);

      if (response.roles.length > 0 && !selectedRole && response.roles[0]) {
        setSelectedRole(response.roles[0].role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [selectedRole]);

  const fetchRoleUsers = useCallback(async (role: string) => {
    try {
      const response = await api.security.rbac.getUsersByRole(role);
      if (!response.ok) {
        throw new Error("Failed to fetch role users");
      }

      // Map API response to RbacUser format
      const roleUsers: RbacUser[] = (response.users || []).map((user: any) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lastLogin: user.lastLogin,
        isActive: user.isActive,
      }));

      setRoleUsers(roleUsers);
    } catch {
      // Failed to fetch role users — list will remain empty
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    if (selectedRole) {
      fetchRoleUsers(selectedRole);
    }
  }, [selectedRole, fetchRoleUsers]);

  const handleRoleChange = async (userId: string, newRole: string, reason: string) => {
    try {
      setActionLoading(userId);

      const response = await api.security.rbac.updateUserRole(userId, newRole, reason);
      if (!response.ok) {
        throw new Error("Failed to update user role");
      }

      // Update local state
      setRoleUsers((prev) => prev.filter((user) => user.id !== userId));
      alert("User role updated successfully");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update user role");
    } finally {
      setActionLoading(null);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "SUPER_ADMIN":
        return "bg-purple-100 text-purple-800";
      case "ADMIN":
        return "bg-blue-100 text-blue-800";
      case "SUPPORT":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded-sm mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-64 bg-gray-200 rounded-sm"></div>
            <div className="md:col-span-2 h-64 bg-gray-200 rounded-sm"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading RBAC Manager</h3>
          <p className="text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const selectedRoleInfo = roles.find((r) => r.role === selectedRole);

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Role-Based Access Control</h2>
        <p className="text-gray-600">Manage user roles and permissions</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Roles Sidebar */}
        <div className="lg:col-span-1">
          <h3 className="text-sm font-medium text-gray-700 mb-3">System Roles</h3>
          <div className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.role}
                onClick={() => setSelectedRole(role.role)}
                className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                  selectedRole === role.role
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(role.role)}`}
                  >
                    {role.role}
                  </span>
                  <span className="text-sm text-gray-600">{role.userCount} users</span>
                </div>
                <div className="text-sm text-gray-600">{role.description}</div>
              </button>
            ))}
          </div>

          {/* Permission Categories */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Permission Categories</h3>
            <div className="space-y-2">
              {Object.entries(permissionCategories).map(([category, perms]) => (
                <div key={category} className="p-2 bg-gray-50 rounded-sm text-sm">
                  <div className="font-medium text-gray-700">{category}</div>
                  <div className="text-gray-600">{perms.length} permissions</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Role Details and Users */}
        <div className="lg:col-span-2">
          {selectedRoleInfo && (
            <>
              {/* Role Information */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{selectedRoleInfo.role}</h3>
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(selectedRoleInfo.role)}`}
                  >
                    {selectedRoleInfo.userCount} users
                  </span>
                </div>
                <p className="text-gray-600 mb-3">{selectedRoleInfo.description}</p>

                {/* Permissions */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Permissions ({selectedRoleInfo.permissions.length})
                  </h4>
                  <div className="grid grid-cols-2 gap-1">
                    {selectedRoleInfo.permissions.map((permission) => (
                      <div
                        key={permission}
                        className="text-xs bg-white px-2 py-1 rounded-sm border"
                      >
                        {permission.replace(/[_:]/g, " ").toLowerCase()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Users with this role */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Users with {selectedRoleInfo.role} role
                </h3>
                {roleUsers.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    No users found with this role
                  </div>
                ) : (
                  <div className="space-y-3">
                    {roleUsers.map((user) => (
                      <div key={user.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3">
                              <div>
                                <h4 className="font-medium text-gray-900">{user.name}</h4>
                                <p className="text-sm text-gray-600">{user.email}</p>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span
                                  className={`inline-flex items-center px-2 py-1 text-xs rounded-full ${
                                    user.isActive
                                      ? "bg-green-100 text-green-800"
                                      : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  <div
                                    className={`w-2 h-2 rounded-full mr-1 ${
                                      user.isActive ? "bg-green-500" : "bg-red-500"
                                    }`}
                                  ></div>
                                  {user.isActive ? "Active" : "Inactive"}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 text-sm text-gray-600">
                              Last login:{" "}
                              {user.lastLogin
                                ? new Date(user.lastLogin).toLocaleDateString()
                                : "Never"}
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <select
                              className="text-sm border border-gray-300 rounded-sm px-2 py-1"
                              defaultValue={user.role}
                              onChange={(e) => {
                                if (e.target.value !== user.role) {
                                  const reason = prompt(
                                    `Change ${user.name}'s role from ${user.role} to ${e.target.value}?\n\nPlease provide a reason:`
                                  );
                                  if (reason) {
                                    handleRoleChange(user.id, e.target.value, reason);
                                  } else {
                                    e.target.value = user.role; // Reset if cancelled
                                  }
                                }
                              }}
                              disabled={actionLoading === user.id}
                            >
                              {roles.map((role) => (
                                <option key={role.role} value={role.role}>
                                  {role.role}
                                </option>
                              ))}
                            </select>

                            <button
                              className="text-sm text-blue-600 hover:text-blue-800"
                              onClick={() => {
                                // In a real app, this would open a detailed permission view
                                alert(`View detailed permissions for ${user.name}`);
                              }}
                            >
                              View Permissions
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
