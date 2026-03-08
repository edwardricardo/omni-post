"use client";

/**
 * @file MfaManager.tsx
 * @description Admin MFA management panel for viewing user MFA status and performing
 * administrative actions such as force-disabling MFA and generating backup codes.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/apiClient";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  mfaEnabled: boolean;
  backupCodesCount: number;
}

export default function MfaManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await api.admin.getAccounts({ limit: 100 });
      if (!response.ok) {
        throw new Error("Failed to load accounts");
      }

      const usersWithMfa: User[] = await Promise.all(
        response.data.accounts.map(async (account) => {
          let backupCodesCount = 0;
          if (account.mfaEnabled) {
            try {
              const mfaResponse = await api.security.mfa.getUserStatus(account.id);
              if (mfaResponse.ok) {
                backupCodesCount = mfaResponse.mfa.backupCodesCount;
              }
            } catch {
              // MFA status fetch failed — use default count
            }
          }
          return {
            id: account.id,
            email: account.email,
            name: account.name,
            role: account.role,
            mfaEnabled: account.mfaEnabled,
            backupCodesCount,
          };
        })
      );

      setUsers(usersWithMfa);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleForceDisableMfa = async (userId: string, reason: string) => {
    try {
      setActionLoading(userId);

      const response = await api.security.mfa.forceDisable(userId, reason);
      if (!response.ok) {
        throw new Error("Failed to disable MFA");
      }

      // Update local state
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, mfaEnabled: false, backupCodesCount: 0 } : user
        )
      );

      alert("MFA disabled successfully");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to disable MFA");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded-sm mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-sm"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading MFA Manager</h3>
          <p className="text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Multi-Factor Authentication Management
        </h2>
        <p className="text-gray-600">Manage MFA settings for admin users</p>
      </div>

      {/* MFA Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">Total Users</div>
          <div className="text-2xl font-bold text-gray-900">{users.length}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-sm text-green-600">MFA Enabled</div>
          <div className="text-2xl font-bold text-green-900">
            {users.filter((u) => u.mfaEnabled).length}
          </div>
        </div>
        <div className="bg-red-50 p-4 rounded-lg">
          <div className="text-sm text-red-600">MFA Disabled</div>
          <div className="text-2xl font-bold text-red-900">
            {users.filter((u) => !u.mfaEnabled).length}
          </div>
        </div>
      </div>

      {/* User List */}
      <div className="space-y-4">
        {users.map((user) => (
          <div key={user.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <div>
                    <h3 className="font-medium text-gray-900">{user.name}</h3>
                    <p className="text-sm text-gray-600">{user.email}</p>
                  </div>
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      user.role === "SUPER_ADMIN"
                        ? "bg-purple-100 text-purple-800"
                        : user.role === "ADMIN"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
                <div className="mt-2 flex items-center space-x-4">
                  <span
                    className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                      user.mfaEnabled ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mr-1 ${
                        user.mfaEnabled ? "bg-green-500" : "bg-red-500"
                      }`}
                    ></div>
                    MFA {user.mfaEnabled ? "Enabled" : "Disabled"}
                  </span>
                  {user.mfaEnabled && (
                    <span className="text-xs text-gray-600">
                      {user.backupCodesCount} backup codes remaining
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedUser(user)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-sm hover:bg-gray-50"
                >
                  View Details
                </button>
                {user.mfaEnabled && (
                  <button
                    onClick={() => {
                      const reason = prompt("Please provide a reason for disabling MFA:");
                      if (reason) {
                        handleForceDisableMfa(user.id, reason);
                      }
                    }}
                    disabled={actionLoading === user.id}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    {actionLoading === user.id ? "Disabling..." : "Force Disable"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">MFA Details</h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">User</label>
                <div className="mt-1">
                  <div className="font-medium">{selectedUser.name}</div>
                  <div className="text-sm text-gray-600">{selectedUser.email}</div>
                  <div className="text-sm text-gray-600">Role: {selectedUser.role}</div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">MFA Status</label>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                      selectedUser.mfaEnabled
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {selectedUser.mfaEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>

              {selectedUser.mfaEnabled && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Backup Codes</label>
                  <div className="mt-1 text-sm text-gray-900">
                    {selectedUser.backupCodesCount} codes remaining
                  </div>
                  {selectedUser.backupCodesCount < 3 && (
                    <div className="text-sm text-amber-600 mt-1">
                      ⚠️ Low backup codes - user should regenerate
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end space-x-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
